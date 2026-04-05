import type { Port, SignalType, ConnectorType } from "../../../src/types";
import { SIGNAL_LABELS, CONNECTOR_LABELS, SIGNAL_GROUPS, CONNECTOR_GROUPS } from "../../../src/types";
import { DEFAULT_CONNECTOR } from "../../../src/connectorTypes";
import SearchableSelect from "./SearchableSelect";

const NETWORK_SIGNAL_TYPES = new Set(["ethernet", "ndi", "dante", "srt", "hdbaset"]);

interface PortRowProps {
  port: Port;
  selected?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
  onChange: (updates: Partial<Port>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export default function PortRow({ port, selected, onSelect, onChange, onRemove, onMoveUp, onMoveDown }: PortRowProps) {
  const handleSignalChange = (newSignal: SignalType) => {
    const updates: Partial<Port> = { signalType: newSignal };
    // Auto-update connector if current connector is the default for old signal or unset
    const currentDefault = DEFAULT_CONNECTOR[port.signalType];
    const isConnectorDefault = !port.connectorType || port.connectorType === "none" || port.connectorType === currentDefault;
    if (isConnectorDefault) {
      updates.connectorType = DEFAULT_CONNECTOR[newSignal];
    }
    if (!NETWORK_SIGNAL_TYPES.has(newSignal)) {
      updates.addressable = undefined;
    }
    onChange(updates);
  };

  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-2 p-2 rounded-lg border transition-colors cursor-pointer ${
        selected
          ? "bg-indigo-50 border-indigo-300 ring-1 ring-indigo-300"
          : "bg-white border-slate-200 hover:border-slate-300"
      }`}
    >
      <span
        className="w-3 h-3 rounded-full shrink-0"
        style={{ backgroundColor: `var(--color-${port.signalType})` }}
      />
      <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
        <input
          type="text"
          value={port.label}
          onChange={(e) => onChange({ label: e.target.value })}
          className="w-full sm:flex-1 sm:w-auto min-w-0 px-2 py-1 rounded border border-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Label"
        />
        <SearchableSelect<SignalType>
          value={port.signalType}
          onChange={handleSignalChange}
          groups={SIGNAL_GROUPS}
          labels={SIGNAL_LABELS}
          className="px-2 py-1 rounded border border-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[100px]"
        />
        <SearchableSelect<ConnectorType>
          value={(port.connectorType ?? "none") as ConnectorType}
          onChange={(v) => onChange({ connectorType: v })}
          groups={CONNECTOR_GROUPS}
          labels={CONNECTOR_LABELS}
          recommended={DEFAULT_CONNECTOR[port.signalType]}
          recommendedLabel={`Default for ${SIGNAL_LABELS[port.signalType]}`}
          className="px-2 py-1 rounded border border-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[100px]"
        />
        <input
          type="text"
          value={port.section ?? ""}
          onChange={(e) => onChange({ section: e.target.value || undefined })}
          className="w-full sm:w-24 px-2 py-1 rounded border border-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Section"
        />
        {NETWORK_SIGNAL_TYPES.has(port.signalType) && (
          <label className="flex items-center gap-1 text-xs text-slate-500 whitespace-nowrap" title="Port has an IP address / network stack">
            <input
              type="checkbox"
              checked={port.addressable !== false}
              onChange={(e) => onChange({ addressable: e.target.checked ? undefined : false })}
              className="cursor-pointer"
            />
            Addr
          </label>
        )}
        <div className="flex flex-col">
          <button onClick={onMoveUp} className="text-slate-400 hover:text-slate-600 text-xs leading-none" title="Move up">&#9650;</button>
          <button onClick={onMoveDown} className="text-slate-400 hover:text-slate-600 text-xs leading-none" title="Move down">&#9660;</button>
        </div>
        <button
          onClick={onRemove}
          className="text-red-400 hover:text-red-600 text-lg leading-none px-1 transition-colors"
          title="Remove port"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
