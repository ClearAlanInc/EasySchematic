import { memo, useMemo, useCallback, useState } from "react";
import { HoverCard, HoverRow, HoverTitle } from "./HoverCard";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { DeviceNode as DeviceNodeType, Port } from "../types";
import { SIGNAL_COLORS, SIGNAL_LABELS, CONNECTOR_LABELS, portSide } from "../types";
import { useSchematicStore } from "../store";
import {
  resolveAuxiliaryLine,
  auxRowHeight,
  rowsInSlot,
  headerBandHeight,
  HEADER_LABEL_ZONE_PX,
  HEADER_LABEL_ZONE_2_PX,
} from "../auxiliaryData";
import type { AuxRow } from "../types";
import { useDisplayLabel } from "../labelCaseUtils";
import { resolveDeviceLabel } from "../displayName";
import { isPortConnected } from "../portVisibility";
import { isVirtualSignal, NETWORK_SIGNAL_TYPES } from "../connectorTypes";

type ColumnItem =
  | { type: "port"; port: Port }
  | { type: "section"; name: string }
  | { type: "divider" };

/** Build a list of ports interleaved with section headers where section changes. */
function buildColumnItems(ports: Port[]): ColumnItem[] {
  const items: ColumnItem[] = [];
  let lastSection: string | undefined;
  for (const port of ports) {
    if (port.section && port.section !== lastSection) {
      items.push({ type: "section", name: port.section });
    } else if (!port.section && lastSection) {
      // A section just ended into unsectioned ports — emit a closing divider so
      // the following ports don't read as part of the section. (A section
      // followed by ANOTHER section needs nothing; that section's own header is
      // the boundary.)
      items.push({ type: "divider" });
    }
    items.push({ type: "port", port });
    lastSection = port.section;
  }
  return items;
}

function DeviceNodeComponent({ id, data, selected }: NodeProps<DeviceNodeType>) {
  const setEditingNodeId = useSchematicStore((s) => s.setEditingNodeId);
  const displayLabel = useDisplayLabel();
  const useShortNames = useSchematicStore((s) => s.useShortNames);
  const wrapDeviceLabels = useSchematicStore((s) => s.wrapDeviceLabels);
  const resolvedLabel = useMemo(
    () => resolveDeviceLabel(data, { useShortNames, wrapDeviceLabels }),
    [data, useShortNames, wrapDeviceLabels],
  );
  const labelZone = resolvedLabel.wrap ? HEADER_LABEL_ZONE_2_PX : HEADER_LABEL_ZONE_PX;
  const hiddenPinSignalTypesStr = useSchematicStore((s) => s.hiddenPinSignalTypes);
  const isHiddenAdapter = useSchematicStore((s) => s.hiddenAdapterNodeIds.has(id));
  const isOverlapping = useSchematicStore((s) => s.overlapNodeId === id);

  const hiddenPinSignalTypes = useMemo(
    () => (hiddenPinSignalTypesStr ? new Set(hiddenPinSignalTypesStr.split(",")) : null),
    [hiddenPinSignalTypesStr],
  );

  const globalHideUnconnectedPorts = useSchematicStore((s) => s.hideUnconnectedPorts);
  const hideVirtual = useSchematicStore((s) => s.hideVirtualConnections);
  // Effective filter = global view toggle OR this device's per-device toggle (#135).
  const hideUnconnectedPorts = globalHideUnconnectedPorts || !!data.showOnlyConnectedPorts;
  const showPortCounts = useSchematicStore((s) => s.showPortCounts);
  const currency = useSchematicStore((s) => s.currency);
  const templateHiddenStr = useSchematicStore((s) => {
    if (!data.templateId) return "";
    const arr = s.templateHiddenSignals[data.templateId];
    return arr ? arr.sort().join(",") : "";
  });

  const connectedHandleStr = useSchematicStore((s) => {
    const ids: string[] = [];
    for (const e of s.edges) {
      if (e.source === id && e.sourceHandle) ids.push(e.sourceHandle);
      if (e.target === id && e.targetHandle) ids.push(e.targetHandle);
    }
    return ids.sort().join(",");
  });
  const connectedHandles = useMemo(
    () => new Set(connectedHandleStr ? connectedHandleStr.split(",") : []),
    [connectedHandleStr],
  );

  // Handles carrying a *physical* cable. Virtual wires (TCP/UDP) ride the physical run
  // and stack without limit, so they must not make a port look occupied — only the one
  // real cable does.
  const physicalHandleStr = useSchematicStore((s) => {
    const ids: string[] = [];
    for (const e of s.edges) {
      if (isVirtualSignal(e.data?.signalType)) continue;
      if (e.source === id && e.sourceHandle) ids.push(e.sourceHandle);
      if (e.target === id && e.targetHandle) ids.push(e.targetHandle);
    }
    return ids.sort().join(",");
  });
  const physicalHandles = useMemo(
    () => new Set(physicalHandleStr ? physicalHandleStr.split(",") : []),
    [physicalHandleStr],
  );

  // Reactive signal-type map for edges connected to this node — drives passthrough port
  // color/label when the port inherits its signal type from the connected edge. Serialized
  // as "handleId:signalType" pairs so Zustand's shallow equality catches signal-type edits.
  const connectedEdgeSignalsStr = useSchematicStore((s) => {
    const parts: string[] = [];
    for (const e of s.edges) {
      if (!e.data?.signalType) continue;
      if (e.source === id && e.sourceHandle) parts.push(`${e.sourceHandle}:${e.data.signalType}`);
      if (e.target === id && e.targetHandle) parts.push(`${e.targetHandle}:${e.data.signalType}`);
    }
    return parts.sort().join(",");
  });
  const signalByHandle = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    if (!connectedEdgeSignalsStr) return m;
    for (const pair of connectedEdgeSignalsStr.split(",")) {
      const colon = pair.lastIndexOf(":");
      if (colon > 0) m.set(pair.slice(0, colon), pair.slice(colon + 1));
    }
    return m;
  }, [connectedEdgeSignalsStr]);

  const visiblePorts = useMemo(() => {
    if (data.showAllPorts) {
      const shown = hideVirtual ? data.ports.filter((p) => !p.parentPortId) : data.ports;
      return hiddenPinSignalTypes
        ? shown.filter((p) => !hiddenPinSignalTypes.has(p.signalType))
        : shown;
    }

    const tplHidden = templateHiddenStr ? new Set(templateHiddenStr.split(",")) : null;
    const devHiddenPorts = data.hiddenPorts?.length ? new Set(data.hiddenPorts) : null;

    return data.ports.filter((p) => {
      // Sub-handles are purely virtual; drop them when that layer is hidden.
      if (hideVirtual && p.parentPortId) return false;
      if (hiddenPinSignalTypes?.has(p.signalType)) return false;
      if (tplHidden?.has(p.signalType)) return false;
      if (devHiddenPorts?.has(p.id)) return false;
      if (hideUnconnectedPorts && !isPortConnected(p, connectedHandles)) return false;
      return true;
    });
  }, [data.ports, data.showAllPorts, data.hiddenPorts, hideVirtual,
      hiddenPinSignalTypes, templateHiddenStr, hideUnconnectedPorts, connectedHandles]);

  // Widest label among each network port's sub-handles. Giving every sibling that
  // same width keeps their "└" markers in one column while the block as a whole stays
  // centred under the parent port, instead of hanging off to one side.
  const subHandleWidthCh = useMemo(() => {
    const widest = new Map<string, number>();
    for (const p of data.ports) {
      if (!p.parentPortId) continue;
      const len = displayLabel(p.label).length;
      widest.set(p.parentPortId, Math.max(widest.get(p.parentPortId) ?? 0, len));
    }
    return widest;
  }, [data.ports, displayLabel]);

  // Port hover details card (#hover-features). Tracks the hovered port and the
  // cursor position; the card itself renders into document.body via HoverCard.
  const [hoverPort, setHoverPort] = useState<{ port: Port; x: number; y: number } | null>(null);
  const [hoverDevice, setHoverDevice] = useState<{ x: number; y: number } | null>(null);
  const deviceHoverProps = {
    onMouseEnter: (e: React.MouseEvent) => setHoverDevice({ x: e.clientX, y: e.clientY }),
    onMouseMove: (e: React.MouseEvent) => setHoverDevice({ x: e.clientX, y: e.clientY }),
    onMouseLeave: () => setHoverDevice(null),
  };
  const portHoverProps = (port: Port) => ({
    onMouseEnter: (e: React.MouseEvent) => setHoverPort({ port, x: e.clientX, y: e.clientY }),
    onMouseMove: (e: React.MouseEvent) => setHoverPort({ port, x: e.clientX, y: e.clientY }),
    onMouseLeave: () => setHoverPort(null),
  });
  const DIRECTION_LABELS: Record<string, string> = {
    input: "Input", output: "Output", bidirectional: "Bidirectional", passthrough: "Passthrough",
  };
  const renderPortHoverCard = () => {
    if (!hoverPort) return null;
    const port = hoverPort.port;
    const color = SIGNAL_COLORS[port.signalType] ?? SIGNAL_COLORS.custom;
    const nc = port.networkConfig;
    const vlanText = nc?.vlanMode === "trunk"
      ? `Trunk ${nc.trunkAllVlans ? "(all)" : (nc.trunkVlans ?? []).join(",")}${nc.nativeVlan != null ? ` · native ${nc.nativeVlan}` : ""}`
      : nc?.vlan != null ? String(nc.vlan) : null;
    return (
      <HoverCard x={hoverPort.x} y={hoverPort.y}>
        <HoverTitle text={displayLabel(port.label)} dotColor={color} />
        <HoverRow label="Signal" value={SIGNAL_LABELS[port.signalType] ?? port.signalType} color={color} />
        <HoverRow label="Direction" value={DIRECTION_LABELS[port.direction] ?? port.direction} />
        {port.direction === "passthrough" ? (
          <>
            {port.rearConnectorType && <HoverRow label="Rear" value={CONNECTOR_LABELS[port.rearConnectorType] ?? port.rearConnectorType} />}
            {port.frontConnectorType && <HoverRow label="Front" value={CONNECTOR_LABELS[port.frontConnectorType] ?? port.frontConnectorType} />}
          </>
        ) : (
          port.connectorType && <HoverRow label="Connector" value={CONNECTOR_LABELS[port.connectorType] ?? port.connectorType} />
        )}
        {port.linkSpeed && <HoverRow label="Speed" value={port.linkSpeed} />}
        {port.poeDrawW != null && <HoverRow label="PoE draw" value={`${port.poeDrawW} W`} />}
        {port.usbcPowerSourceW != null && <HoverRow label="USB-C PD" value={`supplies ${port.usbcPowerSourceW} W`} />}
        {port.usbcPowerDrawW != null && <HoverRow label="USB-C PD" value={`draws ${port.usbcPowerDrawW} W`} />}
        {nc?.ip && <HoverRow label="IP" value={nc.ip} />}
        {vlanText && <HoverRow label="VLAN" value={vlanText} />}
        {port.multiConnect && <HoverRow label="Connections" value="multiple allowed" />}
        {port.notes && <div className="mt-1 text-[var(--color-text-muted)] whitespace-pre-wrap">{port.notes}</div>}
      </HoverCard>
    );
  };

  const renderDeviceHoverCard = () => {
    if (!hoverDevice || hoverPort) return null;
    const dims = [data.heightMm, data.widthMm, data.depthMm];
    const dimText = dims.every((d) => d != null) ? `${data.heightMm} × ${data.widthMm} × ${data.depthMm} mm` : null;
    const connected = data.ports.filter((p) => isPortConnected(p, connectedHandles)).length;
    return (
      <HoverCard x={hoverDevice.x} y={hoverDevice.y}>
        <HoverTitle text={displayLabel(data.label)} />
        {(data.manufacturer || data.modelNumber) && (
          <HoverRow label="Model" value={[data.manufacturer, data.modelNumber].filter(Boolean).join(" ")} />
        )}
        <HoverRow label="Type" value={data.deviceType} />
        {data.hostname && data.hostname !== data.label && <HoverRow label="Hostname" value={data.hostname} />}
        <HoverRow label="Ports" value={`${connected} of ${data.ports.length} connected`} />
        {data.powerDrawW != null && <HoverRow label="Power" value={`${data.powerDrawW} W`} />}
        {data.poeBudgetW != null && <HoverRow label="PoE budget" value={`${data.poeBudgetW} W`} />}
        {data.poeDrawW != null && <HoverRow label="PoE draw" value={`${data.poeDrawW} W`} />}
        {dimText && <HoverRow label="Size" value={dimText} />}
        {data.weightKg != null && <HoverRow label="Weight" value={`${data.weightKg} kg`} />}
      </HoverCard>
    );
  };

  const headerAuxRows = useMemo(
    () => rowsInSlot(data.auxiliaryData, "header"),
    [data.auxiliaryData],
  );
  const footerAuxRows = useMemo(
    () => rowsInSlot(data.auxiliaryData, "footer"),
    [data.auxiliaryData],
  );

  const portCountInfo = useMemo(() => {
    if (!showPortCounts) return null;
    const total = data.ports.length;
    if (total === 0) return null;
    let connected = 0;
    for (const p of data.ports) {
      if (isPortConnected(p, connectedHandles)) connected++;
    }
    return { connected, total };
  }, [showPortCounts, data.ports, connectedHandles]);

  const openPortMenu = useCallback((e: React.MouseEvent, port: Port) => {
    e.preventDefault();
    e.stopPropagation();
    useSchematicStore.setState({
      portContextMenu: { nodeId: id, portId: port.id, screenX: e.clientX, screenY: e.clientY },
    });
  }, [id]);


  // Split ports by visual side (respects flip), not semantic direction.
  // When hideUnconnectedPorts is on, bidir ports with only one side connected
  // collapse into the appropriate column so the device gets smaller.
  // Passthrough ports go into their own list — they render as full-width rows with
  // two handles (rear-left, front-right), similar to bidirectional but spanning both sides.
  const { leftPorts, rightPorts, bidirectional, passthroughPorts, collapsedBidir } = useMemo(() => {
    const collapsedBidir = new Map<string, "in" | "out">();
    const leftPorts: Port[] = [];
    const rightPorts: Port[] = [];
    const bidirectional: Port[] = [];
    const passthroughPorts: Port[] = [];
    for (const p of visiblePorts) {
      if (p.direction === "passthrough") {
        passthroughPorts.push(p);
      } else if (p.direction === "bidirectional") {
        if (hideUnconnectedPorts) {
          const inConn = connectedHandles.has(`${p.id}-in`);
          const outConn = connectedHandles.has(`${p.id}-out`);
          if (inConn && !outConn) {
            (p.flipped ? rightPorts : leftPorts).push(p);
            collapsedBidir.set(p.id, "in");
            continue;
          }
          if (outConn && !inConn) {
            (p.flipped ? leftPorts : rightPorts).push(p);
            collapsedBidir.set(p.id, "out");
            continue;
          }
        }
        bidirectional.push(p);
      } else if (portSide(p) === "left") {
        leftPorts.push(p);
      } else {
        rightPorts.push(p);
      }
    }
    return { leftPorts, rightPorts, bidirectional, passthroughPorts, collapsedBidir };
  }, [visiblePorts, hideUnconnectedPorts, connectedHandles]);

  /** Get handle ID and type for a port in a column, accounting for collapsed bidir ports.
   *  All bidirectional handles use type="source" so React Flow always includes them in
   *  handleBounds.source — its getEdgePosition only searches source bounds for sourceHandle,
   *  even in ConnectionMode.Loose. Our isValidConnection handles real direction checks. */
  const handleProps = (port: Port, _side: "left" | "right") => {
    const connSide = collapsedBidir.get(port.id);
    if (connSide) {
      return connSide === "in"
        ? { handleId: `${port.id}-in`, handleType: "source" as const }
        : { handleId: `${port.id}-out`, handleType: "source" as const };
    }
    return {
      handleId: port.id,
      handleType: (port.direction === "input" ? "target" : "source") as "target" | "source",
    };
  };

  const isPatchPanel = data.deviceType === "patch-panel";

  const leftItems = useMemo(() => {
    const items = buildColumnItems(leftPorts);
    if (isPatchPanel && leftPorts.length > 0) {
      return [{ type: "section" as const, name: "Rear" }, ...items];
    }
    return items;
  }, [leftPorts, isPatchPanel]);
  const rightItems = useMemo(() => {
    const items = buildColumnItems(rightPorts);
    if (isPatchPanel && rightPorts.length > 0) {
      return [{ type: "section" as const, name: "Front" }, ...items];
    }
    return items;
  }, [rightPorts, isPatchPanel]);

  const hasSections = leftItems.some((i) => i.type === "section") ||
    rightItems.some((i) => i.type === "section");

  // Build bidirectional items with section support
  const bidirItems = useMemo(() => buildColumnItems(bidirectional), [bidirectional]);

  // Build passthrough items. On patch panels, prepend Rear/Front column headers in the
  // passthrough row header so the label row shows "Rear ← label → Front".
  const passthroughItems = useMemo(
    () => buildColumnItems(passthroughPorts),
    [passthroughPorts],
  );

  /** A thin closing line marking the end of a section that runs into unsectioned ports. */
  const renderDivider = (key: string) => (
    <div key={key} className="h-1.5 flex items-center px-2" aria-hidden>
      <div className="border-b border-[var(--color-border)]/30 w-full" />
    </div>
  );

  /** Render a port row for a column (left or right). */
  const renderColumnPort = (port: Port, side: "left" | "right") => {
    const h = handleProps(port, side);
    const isLeft = side === "left";
    return (
      <div
        key={port.id}
        className={`flex items-center gap-1 ${isLeft ? "pl-3" : "pr-3 justify-end"} h-4 relative`}
        onContextMenu={(e) => openPortMenu(e, port)}
        {...portHoverProps(port)}
      >
        {isLeft && (
          <Handle
            type={h.handleType}
            position={Position.Left}
            id={h.handleId}
            data-connected={connectedHandles.has(h.handleId) || undefined}
            data-multi-connect={port.multiConnect || undefined}
            className="!w-2.5 !h-2.5 !border-2 !border-[var(--color-border)] !-left-[5px]"
            style={{ background: SIGNAL_COLORS[port.signalType], top: "50%" }}
          />
        )}
        <span
          className="text-[10px] leading-4 truncate"
          style={{ color: SIGNAL_COLORS[port.signalType] }}
        >
          {displayLabel(port.label)}
        </span>
        {!isLeft && (
          <Handle
            type={h.handleType}
            position={Position.Right}
            id={h.handleId}
            data-connected={connectedHandles.has(h.handleId) || undefined}
            data-multi-connect={port.multiConnect || undefined}
            className="!w-2.5 !h-2.5 !border-2 !border-[var(--color-border)] !-right-[5px]"
            style={{ background: SIGNAL_COLORS[port.signalType], top: "50%" }}
          />
        )}
      </div>
    );
  };

  /** Render a passthrough port as a full-width row with a handle on each edge.
   *  Patch panels read rack-style: rear (field termination) left, front (patch) right.
   *  Wall plates read signal-flow style: the front jack is where the local device
   *  plugs in, so front goes LEFT (input side) and rear RIGHT (feeding onward). */
  const renderPassthroughPort = (port: Port) => {
    const rearId = `${port.id}-rear`;
    const frontId = `${port.id}-front`;
    const frontOnLeft = data.deviceType === "wall-plate";
    const leftId = frontOnLeft ? frontId : rearId;
    const rightId = frontOnLeft ? rearId : frontId;
    const rearConnected = connectedHandles.has(rearId);
    const frontConnected = connectedHandles.has(frontId);
    const leftConnected = frontOnLeft ? frontConnected : rearConnected;
    const rightConnected = frontOnLeft ? rearConnected : frontConnected;
    // For inheriting ports, pick up the connected edge's signal type reactively from
    // signalByHandle (derived from connectedEdgeSignalsStr selector). Prefer rear side;
    // fall back to front, then to the port's stored placeholder.
    const resolvedSignal: string = port.inheritsSignal
      ? (signalByHandle.get(rearId) ?? signalByHandle.get(frontId) ?? port.signalType)
      : port.signalType;
    const signalColor = SIGNAL_COLORS[resolvedSignal as keyof typeof SIGNAL_COLORS] ?? SIGNAL_COLORS.custom;
    return (
      <div
        key={port.id}
        className="flex justify-between items-center relative h-4"
        onContextMenu={(e) => openPortMenu(e, port)}
        {...portHoverProps(port)}
      >
        {/* Left handle — source (ConnectionMode.Loose; isValidConnection enforces direction) */}
        <Handle
          type="source"
          position={Position.Left}
          id={leftId}
          data-connected={leftConnected || undefined}
          className="!w-2.5 !h-2.5 !border-2 !border-[var(--color-border)] !-left-[5px]"
          style={{ background: signalColor, top: "50%" }}
        />
        <span
          className="text-[10px] leading-4 truncate px-3 flex-1 text-center"
          style={{ color: signalColor }}
        >
          ⇔ {displayLabel(port.label)}
        </span>
        {/* Right handle — source (same reasoning as left) */}
        <Handle
          type="source"
          position={Position.Right}
          id={rightId}
          data-connected={rightConnected || undefined}
          className="!w-2.5 !h-2.5 !border-2 !border-[var(--color-border)] !-right-[5px]"
          style={{ background: signalColor, top: "50%" }}
        />
      </div>
    );
  };

  if (isHiddenAdapter) {
    // Render 1x1 invisible placeholder — keeps React Flow handle refs valid but
    // doesn't block device placement (RF re-measures this as ~1px)
    return (
      <div style={{ width: 1, height: 1, overflow: "hidden", opacity: 0, pointerEvents: "none" }}>
        {data.ports.map((p) => {
          if (p.direction === "bidirectional") {
            return (
              <span key={p.id}>
                <Handle type="target" position={Position.Left} id={`${p.id}-in`} style={{ opacity: 0 }} />
                <Handle type="source" position={Position.Right} id={`${p.id}-out`} style={{ opacity: 0 }} />
              </span>
            );
          }
          if (p.direction === "passthrough") {
            return (
              <span key={p.id}>
                <Handle type="source" position={Position.Left} id={`${p.id}-rear`} style={{ opacity: 0 }} />
                <Handle type="source" position={Position.Right} id={`${p.id}-front`} style={{ opacity: 0 }} />
              </span>
            );
          }
          const side = portSide(p);
          return (
            <Handle
              key={p.id}
              type={p.direction === "input" ? "target" : "source"}
              position={side === "left" ? Position.Left : Position.Right}
              id={p.id}
              style={{ opacity: 0 }}
            />
          );
        })}
      </div>
    );
  }

  /** Footer aux block — rows below the port area. Grid-rounded (16-multiple) so device
   *  bottom stays on the snap grid. Blank rows render as 6-px separator gaps. */
  function renderFooterAuxBlock(rows: AuxRow[]) {
    if (rows.length === 0) return null;
    const raw = 1 + rows.reduce((sum, r) => sum + auxRowHeight(r), 0);
    const totalPad = Math.ceil(raw / 16) * 16 - raw;
    const pt = Math.floor(totalPad / 2);
    const pb = totalPad - pt;
    return (
      <div
        className="auxiliaryData px-3 border-t border-[var(--color-border)]"
        style={{ paddingTop: pt, paddingBottom: pb }}
      >
        {rows.map((row, i) => renderAuxRow(row, i))}
      </div>
    );
  }

  /** Individual aux row markup shared between header band and footer block. */
  function renderAuxRow(row: AuxRow, key: number) {
    if (!row.text.trim()) {
      return <div key={key} aria-hidden style={{ height: 6 }} />;
    }
    const resolved = displayLabel(resolveAuxiliaryLine(row.text, data, { connectedCount: portCountInfo?.connected, currency }));
    return (
      <div
        key={key}
        className="text-[9px] text-[var(--color-text-muted)] leading-3 truncate whitespace-nowrap text-center"
        title={resolved}
      >
        {resolved}
      </div>
    );
  }

  /** Header band — label zone + header aux rows, centered together in a 16-multiple band.
   *  Replaces the old separate name strip + header aux block: eliminates the ~14-px
   *  wasted whitespace between the label and the first aux row.
   *
   *  Keep the band-height formula in sync with `headerBandHeight()` in auxiliaryData.ts —
   *  snapUtils uses it to estimate device height before React Flow measures it. */
  function renderHeaderBand(rows: AuxRow[]) {
    const bandH = headerBandHeight(data.auxiliaryData, labelZone);
    const content = labelZone + rows.reduce((sum, r) => sum + auxRowHeight(r), 0);
    const totalPad = bandH - content;
    const pt = Math.floor(totalPad / 2);
    const pb = totalPad - pt;
    const labelStyle = resolvedLabel.wrap
      ? {
          display: "-webkit-box" as const,
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical" as const,
          overflow: "hidden" as const,
          wordBreak: "break-word" as const,
          textAlign: "center" as const,
          lineHeight: "14px",
        }
      : undefined;
    return (
      <div
        className="px-3 border-b border-[var(--color-border)] rounded-t-lg flex flex-col"
        style={{
          backgroundColor: data.headerColor || "var(--color-surface)",
          paddingTop: pt,
          paddingBottom: pb,
        }}
        {...deviceHoverProps}
      >
        <div
          className="flex items-center justify-center"
          style={{ height: labelZone }}
        >
          <span
            className={
              resolvedLabel.wrap
                ? "text-xs font-semibold text-[var(--color-text-heading)]"
                : "text-xs font-semibold text-[var(--color-text-heading)] truncate leading-tight"
            }
            style={labelStyle}
          >
            {displayLabel(resolvedLabel.text)}
          </span>
        </div>
        {rows.map((row, i) => renderAuxRow(row, i))}
      </div>
    );
  }

  return (
    <div
      onDoubleClick={() => setEditingNodeId(id)}
      className={`
        relative rounded-lg border bg-white
        ${isOverlapping ? "border-red-400 shadow-lg shadow-red-400/30" : selected ? "border-blue-500 shadow-lg shadow-blue-500/20" : "border-[var(--color-border)]"}
      `}
      style={{ width: 144 }}
    >
      {/* Header band — merged name strip + header aux rows. Height is always a 16-multiple
           (min 32) so the first port below stays on the pathfinding grid. */}
      {renderHeaderBand(headerAuxRows)}

      {/* Port area — 6px top padding lands handle centers on the 16px grid:
           1px (outer top border) + headerBand(16-mult) + 1px (header border-b)
           + 6px (pt) + 8px (half row) ≡ 0 mod 16.
           The header's `border-b` adds 1px between the band and the port column,
           which the `pt` value (6 not 7) compensates for. */}
      <div className="pt-[6px] pb-[7px]">
      {/* Input/Output Ports — two independent columns */}
      {(leftPorts.length > 0 || rightPorts.length > 0) && (
        hasSections ? (
          /* Sectioned layout: independent columns */
          <div className="flex">
            {/* Left column */}
            <div className="flex-1 min-w-0">
              {leftItems.map((item, i) =>
                item.type === "section" ? (
                  <div key={`lsec-${i}`} className="h-4 flex items-end pl-2">
                    <span className="text-[9px] text-[var(--color-text-muted)] truncate border-b border-[var(--color-border)]/30 w-full pb-0.5 mr-1">
                      {item.name}
                    </span>
                  </div>
                ) : item.type === "divider" ? (
                  renderDivider(`ldiv-${i}`)
                ) : renderColumnPort(item.port, "left"),
              )}
            </div>

            {/* Right column */}
            <div className="flex-1 min-w-0">
              {rightItems.map((item, i) =>
                item.type === "section" ? (
                  <div key={`rsec-${i}`} className="h-4 flex items-end pr-2">
                    <span className="text-[9px] text-[var(--color-text-muted)] truncate text-right border-b border-[var(--color-border)]/30 w-full pb-0.5 ml-1">
                      {item.name}
                    </span>
                  </div>
                ) : item.type === "divider" ? (
                  renderDivider(`rdiv-${i}`)
                ) : renderColumnPort(item.port, "right"),
              )}
            </div>
          </div>
        ) : (
          /* Non-sectioned layout: paired rows */
          <div>
            {Array.from({ length: Math.max(leftPorts.length, rightPorts.length, 1) }, (_, i) => {
              const left = leftPorts[i];
              const right = rightPorts[i];
              const lh = left ? handleProps(left, "left") : null;
              const rh = right ? handleProps(right, "right") : null;
              return (
                <div key={i} className="flex justify-between items-center relative h-4">
                  <div className="flex items-center gap-1 pl-3 min-w-0 flex-1" onContextMenu={left ? (e) => openPortMenu(e, left) : undefined} {...(left ? portHoverProps(left) : {})}>
                    {left && lh && (
                      <>
                        <Handle
                          type={lh.handleType}
                          position={Position.Left}
                          id={lh.handleId}
                          data-connected={connectedHandles.has(lh.handleId) || undefined}
                          data-multi-connect={left.multiConnect || undefined}
                          className="!w-2.5 !h-2.5 !border-2 !border-[var(--color-border)] !-left-[5px]"
                          style={{ background: SIGNAL_COLORS[left.signalType], top: "50%" }}
                        />
                        <span
                          className="text-[10px] leading-4 truncate"
                          style={{ color: SIGNAL_COLORS[left.signalType] }}
                        >
                          {displayLabel(left.label)}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1 pr-3 min-w-0 flex-1 justify-end" onContextMenu={right ? (e) => openPortMenu(e, right) : undefined} {...(right ? portHoverProps(right) : {})}>
                    {right && rh && (
                      <>
                        <span
                          className="text-[10px] leading-4 truncate"
                          style={{ color: SIGNAL_COLORS[right.signalType] }}
                        >
                          {displayLabel(right.label)}
                        </span>
                        <Handle
                          type={rh.handleType}
                          position={Position.Right}
                          id={rh.handleId}
                          data-connected={connectedHandles.has(rh.handleId) || undefined}
                          data-multi-connect={right.multiConnect || undefined}
                          className="!w-2.5 !h-2.5 !border-2 !border-[var(--color-border)] !-right-[5px]"
                          style={{ background: SIGNAL_COLORS[right.signalType], top: "50%" }}
                        />
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Empty Expansion Slots — hidden when slot.hideWhenEmpty (template, storage media
          etc.) or slot.hidden (per-instance user toggle, #211). */}
      {data.slots?.some((s) => !s.cardTemplateId && !s.hideWhenEmpty && !s.hidden) && (
        <div>
          {data.slots.filter((s) => !s.cardTemplateId && !s.hideWhenEmpty && !s.hidden).map((slot) => (
            <div key={slot.slotId} className="flex justify-center items-center h-4 mx-1">
              <span className="text-[9px] text-[var(--color-text-muted)] opacity-40 truncate text-center italic">
                {displayLabel(slot.label)} (empty)
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Passthrough Ports — one row per circuit, rear handle left, front handle right */}
      {passthroughPorts.length > 0 && (
        <div>
          <div className="flex h-4">
            <div className="flex-1 flex items-end pl-2">
              <span className="text-[9px] text-[var(--color-text-muted)] truncate border-b border-[var(--color-border)]/30 w-full pb-0.5 mr-1">
                Rear
              </span>
            </div>
            <div className="flex-1 flex items-end pr-2 justify-end">
              <span className="text-[9px] text-[var(--color-text-muted)] truncate text-right border-b border-[var(--color-border)]/30 w-full pb-0.5 ml-1">
                Front
              </span>
            </div>
          </div>
          {passthroughItems.map((item, i) =>
            item.type === "section" ? (
              <div key={`psec-${i}`} className="flex justify-center items-end h-4 mx-1">
                <span className="text-[9px] text-[var(--color-text-muted)] pb-0.5 truncate border-b border-[var(--color-border)]/30 w-full text-center">
                  {item.name}
                </span>
              </div>
            ) : item.type === "divider" ? (
              renderDivider(`pdiv-${i}`)
            ) : renderPassthroughPort(item.port),
          )}
        </div>
      )}

      {/* Bidirectional Ports */}
      {bidirectional.length > 0 && (
        <div>
          {bidirItems.map((item, i) => {
            if (item.type === "section") {
              return (
                <div key={`bsec-${i}`} className="flex justify-center items-end h-4 mx-1">
                  <span className="text-[9px] text-[var(--color-text-muted)] pb-0.5 truncate border-b border-[var(--color-border)]/30 w-full text-center">
                    {item.name}
                  </span>
                </div>
              );
            }
            if (item.type === "divider") {
              return renderDivider(`bdiv-${i}`);
            }

            const port = item.port;
            const inId = `${port.id}-in`;
            const outId = `${port.id}-out`;
            // A network port never closes: it takes one physical cable and any number of
            // virtual wires on top, so both handles stay live (onConnect makes the extra
            // wires virtual). Other bidirectional ports still take a single cable, and the
            // opposite side greys out once that cable is in.
            const netPort = NETWORK_SIGNAL_TYPES.has(port.signalType);
            const inDisabled = !netPort && physicalHandles.has(outId);
            const outDisabled = !netPort && physicalHandles.has(inId);

            return (
              <div key={port.id} className="flex justify-center items-center relative h-4">
                <Handle
                  type="source"
                  position={Position.Left}
                  id={inId}
                  data-connected={connectedHandles.has(inId) || undefined}
                  data-multi-connect={port.multiConnect || undefined}
                  className="!w-2.5 !h-2.5 !border-2 !border-[var(--color-border)] !-left-[5px]"
                  style={{
                    background: inDisabled ? "#d1d5db" : SIGNAL_COLORS[port.signalType],
                    opacity: inDisabled ? 0.4 : 1,
                    top: "50%",
                  }}
                />
                <span
                  className="text-[10px] leading-4 truncate inline-flex items-center gap-0.5 max-w-full"
                  style={{ color: SIGNAL_COLORS[port.signalType] }}
                  {...portHoverProps(port)}
                >
                  <span className="shrink-0 opacity-70">{port.parentPortId ? "└" : "↔"}</span>
                  {port.parentPortId ? (
                    // Every sibling gets the widest label's width, so the markers line up
                    // and the group still sits centred beneath the parent.
                    <span
                      className="text-left truncate"
                      style={{ width: `${subHandleWidthCh.get(port.parentPortId) ?? 0}ch` }}
                    >
                      {displayLabel(port.label)}
                    </span>
                  ) : (
                    <span className="truncate">{displayLabel(port.label)}</span>
                  )}
                </span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={outId}
                  data-connected={connectedHandles.has(outId) || undefined}
                  data-multi-connect={port.multiConnect || undefined}
                  className="!w-2.5 !h-2.5 !border-2 !border-[var(--color-border)] !-right-[5px]"
                  style={{
                    background: outDisabled ? "#d1d5db" : SIGNAL_COLORS[port.signalType],
                    opacity: outDisabled ? 0.4 : 1,
                    top: "50%",
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
      {portCountInfo && (
        <div className="text-center h-4 flex items-center justify-center">
          <span className="text-[9px] text-[var(--color-text-muted)]">
            {portCountInfo.connected} / {portCountInfo.total} IOs connected
          </span>
        </div>
      )}
      {renderFooterAuxBlock(footerAuxRows)}
      </div>
      {renderPortHoverCard()}
      {renderDeviceHoverCard()}
    </div>
  );
}

export default memo(DeviceNodeComponent);
