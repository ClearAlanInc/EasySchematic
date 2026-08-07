import type { ConnectionEdge, DeviceData, Port, PortNetworkConfig, SchematicNode } from "./types";
import { NETWORK_SIGNAL_TYPES, isVirtualSignal } from "./connectorTypes";

/** A concrete port on a concrete device node. */
export interface PortRef {
  nodeId: string;
  portId: string;
}

export function isTrunk(nc?: PortNetworkConfig): boolean {
  return nc?.vlanMode === "trunk";
}

/** True when a trunk port carries the given VLAN (tagged or native). */
export function trunkAllows(nc: PortNetworkConfig, vlan: number): boolean {
  if (nc.trunkAllVlans) return true;
  if (nc.nativeVlan === vlan) return true;
  return (nc.trunkVlans ?? []).includes(vlan);
}

/**
 * Effective VLAN of a port. Sub-handles (parentPortId set) inherit the parent
 * physical port's VLAN unless they carry their own override — devices that tag
 * per-stream set networkConfig.vlan directly on the sub-handle.
 */
export function effectiveVlan(port: Port, devicePorts: Port[]): number | undefined {
  const own = port.networkConfig?.vlan;
  if (own != null) return own;
  if (port.parentPortId) {
    const parent = devicePorts.find((p) => p.id === port.parentPortId);
    return parent?.networkConfig?.vlan;
  }
  return undefined;
}

/** Parse "1,10,20-30" into a sorted, de-duplicated VLAN list. Returns null on syntax
 *  or range errors so callers can flag invalid input without committing it. */
export function parseVlanList(input: string): number[] | null {
  const out = new Set<number>();
  const trimmed = input.trim();
  if (!trimmed) return [];
  for (const piece of trimmed.split(",")) {
    const m = piece.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) return null;
    const lo = Number(m[1]);
    const hi = m[2] !== undefined ? Number(m[2]) : lo;
    if (lo < 1 || hi > 4094 || hi < lo) return null;
    for (let v = lo; v <= hi; v++) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

/** Format a VLAN list back to compact "1,10,20-30" range syntax. */
export function formatVlanList(vlans: number[]): string {
  const sorted = [...new Set(vlans)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    let end = start;
    while (i + 1 < sorted.length && sorted[i + 1] === end + 1) {
      end = sorted[++i];
    }
    parts.push(start === end ? String(start) : `${start}-${end}`);
  }
  return parts.join(",");
}

/** Human-readable description of what a link carries / why it is misconfigured. */
export interface VlanLinkInfo {
  /** Display string for the wire, e.g. "VLAN 10" or "Trunk 1,10-20". Null when neither end is configured. */
  label: string | null;
  /** Warning when the two ends cannot exchange traffic. Null when compatible. */
  issue: string | null;
}

/** Derive the VLAN annotation and any mismatch warning for a physical network link. */
export function vlanLinkInfo(srcPort: Port | undefined, tgtPort: Port | undefined): VlanLinkInfo {
  const s = srcPort?.networkConfig;
  const t = tgtPort?.networkConfig;
  const sTrunk = isTrunk(s);
  const tTrunk = isTrunk(t);

  const trunkLabel = (nc: PortNetworkConfig): string =>
    nc.trunkAllVlans ? "Trunk (all)" : `Trunk ${formatVlanList(nc.trunkVlans ?? [])}`;

  if (!sTrunk && !tTrunk) {
    const sv = s?.vlan;
    const tv = t?.vlan;
    if (sv != null && tv != null && sv !== tv) {
      return { label: `VLAN ${sv}≠${tv}`, issue: `VLAN mismatch: ${sv} vs ${tv}` };
    }
    const v = sv ?? tv;
    return { label: v != null ? `VLAN ${v}` : null, issue: null };
  }

  if (sTrunk && tTrunk) {
    const sSet = s!;
    const tSet = t!;
    const overlap =
      sSet.trunkAllVlans || tSet.trunkAllVlans ||
      (sSet.trunkVlans ?? []).some((v) => trunkAllows(tSet, v)) ||
      (sSet.nativeVlan != null && trunkAllows(tSet, sSet.nativeVlan));
    return {
      label: sSet.trunkAllVlans ? trunkLabel(tSet) : trunkLabel(sSet),
      issue: overlap ? null : "Trunk allowed VLANs do not overlap",
    };
  }

  // access ↔ trunk
  const trunkNc = sTrunk ? s! : t!;
  const accessVlan = sTrunk ? t?.vlan : s?.vlan;
  if (accessVlan == null) return { label: trunkLabel(trunkNc), issue: null };
  return {
    label: `VLAN ${accessVlan}`,
    issue: trunkAllows(trunkNc, accessVlan)
      ? null
      : `VLAN ${accessVlan} not allowed on trunk (${trunkNc.trunkAllVlans ? "all" : formatVlanList(trunkNc.trunkVlans ?? [])})`,
  };
}

// ── One-hop propagation walker ─────────────────────────────────────────────

const HANDLE_SUFFIX = /-(in|out|rear|front)$/;

function handlePortId(handle: string | null | undefined): string | undefined {
  return handle ? handle.replace(HANDLE_SUFFIX, "") : undefined;
}

function handleFace(handle: string | null | undefined): "rear" | "front" | undefined {
  const m = handle?.match(/-(rear|front)$/);
  return m ? (m[1] as "rear" | "front") : undefined;
}

interface LogicalEnd {
  nodeId: string;
  handle: string | null | undefined;
}

interface LogicalLink {
  a: LogicalEnd;
  b: LogicalEnd;
}

/** Collapse stub-split edges (two legs sharing linkedConnectionId joined at
 *  stub-label nodes) into single logical links with real device endpoints,
 *  and drop virtual (TCP/UDP stream) wires — VLANs ride physical links. */
function physicalLinks(nodes: SchematicNode[], edges: ConnectionEdge[]): LogicalLink[] {
  const stubNodeIds = new Set(nodes.filter((n) => n.type === "stub-label").map((n) => n.id));
  const links: LogicalLink[] = [];
  const stubLegs = new Map<string, Partial<Record<"a" | "b", LogicalEnd>>>();

  for (const e of edges) {
    if (!e.data || isVirtualSignal(e.data.signalType)) continue;
    const link = e.data.linkedConnectionId;
    if (!link) {
      links.push({
        a: { nodeId: e.source, handle: e.sourceHandle },
        b: { nodeId: e.target, handle: e.targetHandle },
      });
      continue;
    }
    const entry = stubLegs.get(link) ?? {};
    if (stubNodeIds.has(e.target)) entry.a = { nodeId: e.source, handle: e.sourceHandle };
    if (stubNodeIds.has(e.source)) entry.b = { nodeId: e.target, handle: e.targetHandle };
    stubLegs.set(link, entry);
  }
  for (const entry of stubLegs.values()) {
    if (entry.a && entry.b) links.push({ a: entry.a, b: entry.b });
  }
  return links;
}

function devicePorts(node: SchematicNode | undefined): Port[] {
  if (!node || node.type !== "device") return [];
  return (node.data as DeviceData).ports;
}

/**
 * Find the access-mode network ports that a VLAN set on `origin` propagates to.
 *
 * Scope is one wire hop: every port directly cabled to the origin port, with the
 * hop continuing *through* passthrough circuits (patch panels / wall plates —
 * enter one face, exit the other, chaining across panels) and across stub-split
 * edges. Ordinary devices terminate the hop; trunk-mode ports are configuration
 * boundaries and are never written to; virtual stream wires are ignored.
 */
export function findPropagationTargets(
  origin: PortRef,
  nodes: SchematicNode[],
  edges: ConnectionEdge[],
): PortRef[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const links = physicalLinks(nodes, edges);

  const targets: PortRef[] = [];
  const seenPorts = new Set<string>([`${origin.nodeId}/${origin.portId}`]);
  // Frontier entries: a port (or one face of a passthrough circuit) whose outgoing
  // links we still need to follow. `face` limits which handles we leave through.
  interface Frontier { nodeId: string; portId: string; face?: "rear" | "front"; }
  const frontier: Frontier[] = [{ nodeId: origin.nodeId, portId: origin.portId }];
  const visitedFrontier = new Set<string>();

  while (frontier.length > 0) {
    const cur = frontier.pop()!;
    const curKey = `${cur.nodeId}/${cur.portId}/${cur.face ?? "*"}`;
    if (visitedFrontier.has(curKey)) continue;
    visitedFrontier.add(curKey);

    for (const link of links) {
      for (const [here, there] of [[link.a, link.b], [link.b, link.a]] as const) {
        if (here.nodeId !== cur.nodeId) continue;
        if (handlePortId(here.handle) !== cur.portId) continue;
        if (cur.face !== undefined && handleFace(here.handle) !== cur.face) continue;

        const farNode = nodeMap.get(there.nodeId);
        const farPortId = handlePortId(there.handle);
        if (!farPortId) continue;
        const farPorts = devicePorts(farNode);
        const farPort = farPorts.find((p) => p.id === farPortId);
        if (!farPort) continue;

        const farKey = `${there.nodeId}/${farPortId}`;
        if (farPort.direction === "passthrough") {
          // Continue out of the circuit's other face (do not assign to the circuit itself).
          const entered = handleFace(there.handle);
          const exitFace = entered === "rear" ? "front" : entered === "front" ? "rear" : undefined;
          frontier.push({ nodeId: there.nodeId, portId: farPortId, face: exitFace });
          continue;
        }
        if (seenPorts.has(farKey)) continue;
        seenPorts.add(farKey);

        if (!NETWORK_SIGNAL_TYPES.has(farPort.signalType)) continue;
        if (isTrunk(farPort.networkConfig)) continue; // trunks are propagation boundaries
        targets.push({ nodeId: there.nodeId, portId: farPortId });
      }
    }
  }
  return targets;
}
