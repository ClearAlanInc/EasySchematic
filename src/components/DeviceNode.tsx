import { memo, useMemo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { DeviceNode as DeviceNodeType, Port } from "../types";
import { SIGNAL_COLORS, SIGNAL_LABELS } from "../types";
import { useSchematicStore } from "../store";

type Slot =
  | { type: "port"; input?: Port; output?: Port }
  | { type: "section"; inputSection?: string; outputSection?: string };

function buildSlots(inputs: Port[], outputs: Port[]): Slot[] {
  const slots: Slot[] = [];
  let ii = 0;
  let oi = 0;
  let lastInputSection: string | undefined;
  let lastOutputSection: string | undefined;

  while (ii < inputs.length || oi < outputs.length) {
    const inp = inputs[ii];
    const out = outputs[oi];

    // Check if either side needs a section header
    const needInputSection = inp && inp.section !== lastInputSection && inp.section;
    const needOutputSection = out && out.section !== lastOutputSection && out.section;

    if (needInputSection || needOutputSection) {
      slots.push({
        type: "section",
        inputSection: needInputSection ? inp.section : undefined,
        outputSection: needOutputSection ? out.section : undefined,
      });
      if (needInputSection) lastInputSection = inp.section;
      if (needOutputSection) lastOutputSection = out.section;
      continue; // Re-evaluate same ports after inserting separator
    }

    slots.push({ type: "port", input: inp, output: out });
    if (inp) { ii++; lastInputSection = inp.section; }
    if (out) { oi++; lastOutputSection = out.section; }
  }

  return slots;
}

function DeviceNodeComponent({ id, data, selected }: NodeProps<DeviceNodeType>) {
  const setEditingNodeId = useSchematicStore((s) => s.setEditingNodeId);

  const connectedHandleStr = useSchematicStore((s) => {
    const ids: string[] = [];
    for (const e of s.edges) {
      if (e.source === id && e.sourceHandle) ids.push(e.sourceHandle);
      if (e.target === id && e.targetHandle) ids.push(e.targetHandle);
    }
    return ids.sort().join(",");
  });
  const connectedHandles = new Set(connectedHandleStr ? connectedHandleStr.split(",") : []);

  const inputs = data.ports.filter((p) => p.direction === "input");
  const outputs = data.ports.filter((p) => p.direction === "output");
  const bidirectional = data.ports.filter((p) => p.direction === "bidirectional");

  const slots = useMemo(() => buildSlots(inputs, outputs), [inputs, outputs]);

  // Build bidirectional slots with section support
  const bidirSlots = useMemo(() => {
    const result: ({ type: "bidir"; port: Port } | { type: "section"; section: string })[] = [];
    let lastSection: string | undefined;
    for (const port of bidirectional) {
      if (port.section && port.section !== lastSection) {
        result.push({ type: "section", section: port.section });
        lastSection = port.section;
      }
      result.push({ type: "bidir", port });
      lastSection = port.section;
    }
    return result;
  }, [bidirectional]);

  return (
    <div
      onDoubleClick={() => setEditingNodeId(id)}
      className={`
        relative rounded-lg border bg-white min-w-[180px]
        ${selected ? "border-blue-500 shadow-lg shadow-blue-500/20" : "border-[var(--color-border)]"}
      `}
    >
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-[var(--color-border)] rounded-t-lg bg-[var(--color-surface)]">
        <div className="text-xs font-semibold text-[var(--color-text-heading)] truncate">
          {data.label}
        </div>
        <div className="text-[10px] text-[var(--color-text-muted)] capitalize">
          {data.deviceType.replace(/-/g, " ")}
        </div>
      </div>

      {/* Input/Output Ports */}
      <div className="py-1">
        {slots.map((slot, i) => {
          if (slot.type === "section") {
            return (
              <div key={`sec-${i}`} className="flex justify-between items-end h-5 border-b border-[var(--color-border)]/30 mx-1 mb-0.5">
                <span className="text-[9px] text-[var(--color-text-muted)] pl-2 pb-0.5 truncate">
                  {slot.inputSection ?? ""}
                </span>
                <span className="text-[9px] text-[var(--color-text-muted)] pr-2 pb-0.5 truncate">
                  {slot.outputSection ?? ""}
                </span>
              </div>
            );
          }

          const { input, output } = slot;
          return (
            <div key={`port-${i}`} className="flex justify-between items-center relative h-7">
              {/* Input port */}
              <div className="flex items-center gap-1 pl-3 min-w-0 flex-1">
                {input && (
                  <>
                    <Handle
                      type="target"
                      position={Position.Left}
                      id={input.id}
                      className="!w-2.5 !h-2.5 !border-2 !border-[var(--color-border)] !-left-[5px]"
                      style={{ background: SIGNAL_COLORS[input.signalType], top: "auto" }}
                    />
                    <span
                      className="text-[10px] truncate"
                      style={{ color: SIGNAL_COLORS[input.signalType] }}
                      title={`${input.label} (${SIGNAL_LABELS[input.signalType]})`}
                    >
                      {input.label}
                    </span>
                  </>
                )}
              </div>

              {/* Output port */}
              <div className="flex items-center gap-1 pr-3 min-w-0 flex-1 justify-end">
                {output && (
                  <>
                    <span
                      className="text-[10px] truncate"
                      style={{ color: SIGNAL_COLORS[output.signalType] }}
                      title={`${output.label} (${SIGNAL_LABELS[output.signalType]})`}
                    >
                      {output.label}
                    </span>
                    <Handle
                      type="source"
                      position={Position.Right}
                      id={output.id}
                      className="!w-2.5 !h-2.5 !border-2 !border-[var(--color-border)] !-right-[5px]"
                      style={{ background: SIGNAL_COLORS[output.signalType], top: "auto" }}
                    />
                  </>
                )}
              </div>
            </div>
          );
        })}

        {/* Bidirectional Ports */}
        {bidirSlots.map((slot, i) => {
          if (slot.type === "section") {
            return (
              <div key={`bsec-${i}`} className="flex justify-center items-end h-5 border-b border-[var(--color-border)]/30 mx-1 mb-0.5">
                <span className="text-[9px] text-[var(--color-text-muted)] pb-0.5 truncate">
                  {slot.section}
                </span>
              </div>
            );
          }

          const port = slot.port;
          const inId = `${port.id}-in`;
          const outId = `${port.id}-out`;
          const inConnected = connectedHandles.has(inId);
          const outConnected = connectedHandles.has(outId);
          const inDisabled = outConnected;
          const outDisabled = inConnected;

          return (
            <div key={port.id} className="flex justify-center items-center relative h-7">
              <Handle
                type="target"
                position={Position.Left}
                id={inId}
                className="!w-2.5 !h-2.5 !border-2 !border-[var(--color-border)] !-left-[5px]"
                style={{
                  background: inDisabled ? "#d1d5db" : SIGNAL_COLORS[port.signalType],
                  opacity: inDisabled ? 0.4 : 1,
                  top: "auto",
                }}
              />
              <span
                className="text-[10px] truncate"
                style={{ color: SIGNAL_COLORS[port.signalType] }}
                title={`${port.label} (${SIGNAL_LABELS[port.signalType]}) — bidirectional`}
              >
                ↔ {port.label}
              </span>
              <Handle
                type="source"
                position={Position.Right}
                id={outId}
                className="!w-2.5 !h-2.5 !border-2 !border-[var(--color-border)] !-right-[5px]"
                style={{
                  background: outDisabled ? "#d1d5db" : SIGNAL_COLORS[port.signalType],
                  opacity: outDisabled ? 0.4 : 1,
                  top: "auto",
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(DeviceNodeComponent);
