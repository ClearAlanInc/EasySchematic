import type { SignalType } from "../../../src/types";
import type { TemplateSummary } from "../api";
import SignalBadge from "./SignalBadge";
import { linkClick } from "../navigate";

export default function DeviceCard({ template }: { template: TemplateSummary }) {
  return (
    <a
      href={`/device/${template.id}`}
      onClick={linkClick}
      className="block p-4 rounded-lg border border-slate-200 hover:border-slate-400 hover:shadow-md transition-all bg-white"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-900 truncate">{template.label}</h3>
          {template.manufacturer && (
            <p className="text-sm text-slate-500 truncate">{template.manufacturer}</p>
          )}
        </div>
        {template.color && (
          <span
            className="w-4 h-4 rounded-full shrink-0 border border-slate-200"
            style={{ backgroundColor: template.color }}
          />
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {template.signalTypes.map((s) => (
          <SignalBadge key={s} signalType={s as SignalType} />
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-400">
        {template.portCount} port{template.portCount !== 1 ? "s" : ""}
        {template.slotCount > 0 && (
          <> &middot; {template.slotCount} slot{template.slotCount !== 1 ? "s" : ""}</>
        )}
      </p>
    </a>
  );
}
