import type { SchematicNode, DeviceData, DhcpServerConfig } from "./types";
import type { ConnectionEdge } from "./types";
import { NETWORK_SIGNAL_TYPES } from "./connectorTypes";

/** Returns true if `ip` is a valid IPv4 address (4 octets, each 0-255). */
export function isValidIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

/** Returns true if `mask` is a valid subnet mask (contiguous 1s then 0s). */
export function isValidSubnetMask(mask: string): boolean {
  if (!isValidIpv4(mask)) return false;
  const bits = mask
    .split(".")
    .map((o) => Number(o).toString(2).padStart(8, "0"))
    .join("");
  return /^1*0*$/.test(bits);
}

/** Returns true if `vlan` is in the valid range 1-4094. */
export function isValidVlan(vlan: number): boolean {
  return Number.isInteger(vlan) && vlan >= 1 && vlan <= 4094;
}

/**
 * Auto-format an IP-like string as the user types.
 * Inserts a period after 3 digits per octet. On paste (when raw differs
 * from prev by more than 1 char), reformat the whole string.
 */
export function formatIpInput(raw: string, prev: string): string {
  // Strip anything that isn't a digit or period
  const cleaned = raw.replace(/[^\d.]/g, "");

  // Detect paste: big jump in length
  const isPaste = Math.abs(cleaned.length - prev.length) > 1;
  if (isPaste) {
    // Strip all dots and reformat from scratch
    const digits = cleaned.replace(/\./g, "");
    return reformatDigits(digits);
  }

  // Normal typing: auto-insert dot after 3 digits per octet
  const parts = cleaned.split(".");
  const rebuilt: string[] = [];
  for (let i = 0; i < parts.length && i < 4; i++) {
    const part = parts[i];
    if (part.length > 3) {
      // Overflow: push first 3 as this octet, rest into next
      rebuilt.push(part.slice(0, 3));
      if (i < 3) {
        const overflow = part.slice(3);
        if (i + 1 < parts.length) {
          parts[i + 1] = overflow + parts[i + 1];
        } else {
          parts.push(overflow);
        }
      }
    } else {
      rebuilt.push(part);
    }
  }

  return rebuilt.join(".");
}

function reformatDigits(digits: string): string {
  // Take up to 12 digits, split into groups of 3
  const capped = digits.slice(0, 12);
  const parts: string[] = [];
  for (let i = 0; i < capped.length; i += 3) {
    parts.push(capped.slice(i, i + 3));
    if (parts.length === 4) break;
  }
  return parts.join(".");
}

/** Convert an IPv4 string to a 32-bit number. Returns null if invalid. */
export function ipToNumber(ip: string): number | null {
  if (!isValidIpv4(ip)) return null;
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** Convert a 32-bit number back to an IPv4 string. */
export function numberToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export interface DuplicateIpInfo {
  nodeId: string;
  portId: string;
  deviceLabel: string;
  portLabel: string;
}

/**
 * Scans all device nodes and returns a map of IP → list of ports using that IP.
 * Only includes IPs that appear on 2+ ports.
 */
export function findDuplicateIps(
  nodes: SchematicNode[],
): Map<string, DuplicateIpInfo[]> {
  const ipMap = new Map<string, DuplicateIpInfo[]>();

  for (const node of nodes) {
    if (node.type !== "device") continue;
    const data = node.data as DeviceData;
    for (const port of data.ports) {
      const ip = port.networkConfig?.ip?.trim();
      if (!ip) continue;
      const entry: DuplicateIpInfo = {
        nodeId: node.id,
        portId: port.id,
        deviceLabel: data.label,
        portLabel: port.label,
      };
      const existing = ipMap.get(ip);
      if (existing) existing.push(entry);
      else ipMap.set(ip, [entry]);
    }
  }

  // Only keep duplicates (2+ entries)
  const dupes = new Map<string, DuplicateIpInfo[]>();
  for (const [ip, entries] of ipMap) {
    if (entries.length > 1) dupes.set(ip, entries);
  }
  return dupes;
}

/** Returns true if `ip` falls within [rangeStart, rangeEnd] (inclusive numeric range). */
export function isIpInDhcpRange(ip: string, rangeStart: string, rangeEnd: string): boolean {
  const n = ipToNumber(ip);
  const start = ipToNumber(rangeStart);
  const end = ipToNumber(rangeEnd);
  if (n === null || start === null || end === null) return false;
  return n >= start && n <= end;
}

export interface ReachableDhcpServer {
  nodeId: string;
  deviceLabel: string;
  config: DhcpServerConfig;
}

/**
 * BFS from startNodeId across network-type edges only, collecting all reachable
 * device nodes that have dhcpServer.enabled === true.
 *
 * NOTE: VLAN-aware traversal is deferred to v2 — AV installs are mostly flat /24 networks.
 */
export function findReachableDhcpServers(
  startNodeId: string,
  nodes: SchematicNode[],
  edges: ConnectionEdge[],
): ReachableDhcpServer[] {
  // Build adjacency map from network-type edges only
  const adj = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!edge.data || !NETWORK_SIGNAL_TYPES.has(edge.data.signalType)) continue;
    const s = edge.source;
    const t = edge.target;
    if (!adj.has(s)) adj.set(s, new Set());
    if (!adj.has(t)) adj.set(t, new Set());
    adj.get(s)!.add(t);
    adj.get(t)!.add(s);
  }

  const nodeMap = new Map<string, SchematicNode>(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const queue: string[] = [startNodeId];
  const results: ReachableDhcpServer[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const node = nodeMap.get(id);
    if (node?.type === "device") {
      const data = node.data as DeviceData;
      if (data.dhcpServer?.enabled) {
        results.push({ nodeId: id, deviceLabel: data.label, config: data.dhcpServer });
      }
    }

    for (const neighbor of adj.get(id) ?? []) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }

  return results;
}

export interface DhcpWarning {
  nodeId: string;
  portId: string;
  type: "no-server" | "ip-in-range";
  message: string;
}

/**
 * Produce DHCP warnings for a set of network report rows:
 * - "no-server": port has dhcp: true (client) but no reachable DHCP server
 * - "ip-in-range": port has a static IP inside a reachable DHCP server's pool
 */
export function computeDhcpWarnings(
  rows: { nodeId: string; portId: string; ip: string; dhcp: boolean }[],
  nodes: SchematicNode[],
  edges: ConnectionEdge[],
): DhcpWarning[] {
  const cache = new Map<string, ReachableDhcpServer[]>();
  const warnings: DhcpWarning[] = [];

  for (const row of rows) {
    if (!cache.has(row.nodeId)) {
      cache.set(row.nodeId, findReachableDhcpServers(row.nodeId, nodes, edges));
    }
    const servers = cache.get(row.nodeId)!;

    if (row.dhcp) {
      if (servers.length === 0) {
        warnings.push({
          nodeId: row.nodeId,
          portId: row.portId,
          type: "no-server",
          message: "DHCP client with no reachable DHCP server",
        });
      }
    } else if (row.ip) {
      for (const srv of servers) {
        const { rangeStart, rangeEnd } = srv.config;
        if (rangeStart && rangeEnd && isIpInDhcpRange(row.ip, rangeStart, rangeEnd)) {
          warnings.push({
            nodeId: row.nodeId,
            portId: row.portId,
            type: "ip-in-range",
            message: `Static IP ${row.ip} is inside DHCP pool of ${srv.deviceLabel} (${rangeStart}–${rangeEnd})`,
          });
          break;
        }
      }
    }
  }

  return warnings;
}
