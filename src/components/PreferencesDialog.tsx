import { useSchematicStore } from "../store";
import { DEFAULT_SCROLL_CONFIG } from "../types";
import type { ScrollAction, ScrollConfig } from "../types";

const ACTION_LABELS: Record<ScrollAction, string> = {
  "zoom": "Zoom",
  "pan-x": "Pan left / right",
  "pan-y": "Pan up / down",
};

const ACTION_OPTIONS: ScrollAction[] = ["zoom", "pan-x", "pan-y"];

const selectClass =
  "bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-2 py-1 text-xs outline-none cursor-pointer w-[140px]";

function ScrollRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ScrollAction;
  onChange: (v: ScrollAction) => void;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-[var(--color-text)]">{label}</span>
      <select
        className={selectClass}
        value={value}
        onChange={(e) => onChange(e.target.value as ScrollAction)}
      >
        {ACTION_OPTIONS.map((a) => (
          <option key={a} value={a}>{ACTION_LABELS[a]}</option>
        ))}
      </select>
    </div>
  );
}

export default function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const scrollConfig = useSchematicStore((s) => s.scrollConfig);
  const setScrollConfig = useSchematicStore((s) => s.setScrollConfig);

  const update = (patch: Partial<ScrollConfig>) =>
    setScrollConfig({ ...scrollConfig, ...patch });

  const isDefault =
    scrollConfig.scroll === DEFAULT_SCROLL_CONFIG.scroll &&
    scrollConfig.shiftScroll === DEFAULT_SCROLL_CONFIG.shiftScroll &&
    scrollConfig.ctrlScroll === DEFAULT_SCROLL_CONFIG.ctrlScroll;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[var(--color-border)] rounded-lg shadow-2xl w-[420px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)]">
          <span className="text-sm font-semibold text-[var(--color-text-heading)]">
            Preferences
          </span>
          <button
            onClick={onClose}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-lg leading-none cursor-pointer"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
              Scroll Wheel
            </div>
            <div className="space-y-0.5">
              <ScrollRow
                label="Scroll"
                value={scrollConfig.scroll}
                onChange={(v) => update({ scroll: v })}
              />
              <ScrollRow
                label="Shift + Scroll"
                value={scrollConfig.shiftScroll}
                onChange={(v) => update({ shiftScroll: v })}
              />
              <ScrollRow
                label="Ctrl + Scroll"
                value={scrollConfig.ctrlScroll}
                onChange={(v) => update({ ctrlScroll: v })}
              />
            </div>
            {!isDefault && (
              <button
                onClick={() => setScrollConfig({ ...DEFAULT_SCROLL_CONFIG })}
                className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] mt-2 cursor-pointer"
              >
                Reset to defaults
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-5 py-3 border-t border-[var(--color-border)]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
