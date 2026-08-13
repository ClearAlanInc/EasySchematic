import { useState } from "react";
import { useSchematicStore } from "../store";
import { checkSession } from "../templateApi";
import { CLOUD_ENABLED } from "../selfHosted";

/**
 * Document revision log (#revision-history). Shows the current major.minor
 * number and the metadata-only history (newest first), and hosts the "New
 * major revision" action with its optional note.
 */
export default function RevisionHistoryDialog({ onClose }: { onClose: () => void }) {
  const revision = useSchematicStore((s) => s.revision);
  const history = useSchematicStore((s) => s.revisionHistory);
  const bumpMajorRevision = useSchematicStore((s) => s.bumpMajorRevision);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);

  const handleMajorBump = async () => {
    let savedBy: string | undefined;
    if (CLOUD_ENABLED) {
      savedBy = (await checkSession().catch(() => null))?.email ?? undefined;
    }
    bumpMajorRevision(note.trim() || undefined, savedBy);
    setNote("");
    setConfirming(false);
  };

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white border border-[var(--color-border)] rounded-lg shadow-2xl w-[460px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)]">
          <span className="text-sm font-semibold text-[var(--color-text-heading)]">
            Revision History — v{revision.major}.{revision.minor}
          </span>
          <button
            onClick={onClose}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-lg leading-none cursor-pointer"
          >
            &times;
          </button>
        </div>

        <div className="px-5 py-3 border-b border-[var(--color-border)]">
          {confirming ? (
            <div className="flex flex-col gap-2">
              <input
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleMajorBump(); if (e.key === "Escape") setConfirming(false); }}
                placeholder="What changed? (optional note)"
                className="w-full text-xs border border-[var(--color-border)] rounded px-2 py-1.5 bg-[var(--color-surface)] text-[var(--color-text)]"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setConfirming(false)}
                  className="text-xs px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleMajorBump()}
                  className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                >
                  Create v{revision.major + 1}.0
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="text-xs px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
            >
              New Major Revision (v{revision.major + 1}.0)…
            </button>
          )}
          <p className="text-[10px] text-[var(--color-text-muted)] mt-2">
            Minor revisions bump automatically on every explicit save. Autosave never bumps.
          </p>
        </div>

        <div className="overflow-y-auto px-5 py-3">
          {history.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted)]">
              No revisions logged yet — the first explicit save will record v{revision.major}.{revision.minor + 1}.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--color-text-muted)]">
                  <th className="pb-1.5 pr-3 font-medium">Rev</th>
                  <th className="pb-1.5 pr-3 font-medium">Saved</th>
                  <th className="pb-1.5 font-medium">By / Note</th>
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map((e, i) => (
                  <tr key={`${e.major}.${e.minor}-${i}`} className="border-t border-[var(--color-border)]/50 align-top">
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      <span className={e.kind === "major" ? "font-semibold" : ""}>v{e.major}.{e.minor}</span>
                      {e.kind === "major" && (
                        <span className="ml-1.5 text-[9px] uppercase tracking-wide text-blue-600">major</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-[var(--color-text-muted)]">{fmt(e.savedAt)}</td>
                    <td className="py-1.5">
                      {e.savedBy && <span className="text-[var(--color-text-muted)]">{e.savedBy}</span>}
                      {e.savedBy && e.note && <span className="text-[var(--color-text-muted)]"> — </span>}
                      {e.note && <span>{e.note}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
