import { useEffect, useState } from "react";
import { useSchematicStore } from "../store";
import { bridgeListGitFiles, bridgeOpenGitFile } from "../mcpBridge";
import type { GitFileEntry } from "../mcp/protocol";
import type { SchematicFile } from "../types";

/**
 * "Open from Git" (#git-save): lists schematic files found inside the git
 * repositories under the MCP bridge's configured root, grouped by repo.
 * Opening one binds the document to its ref, so File > Save to Git writes
 * back to the same file and commits in the same project repository.
 */
export default function GitBrowserDialog({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<GitFileEntry[] | null>(null);
  const [root, setRoot] = useState("");
  const [error, setError] = useState("");
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    bridgeListGitFiles()
      .then((r) => { setRoot(r.root); setFiles(r.files); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const openRef = async (entry: GitFileEntry) => {
    setOpening(entry.ref);
    setError("");
    const store = useSchematicStore.getState();
    try {
      const { json } = await bridgeOpenGitFile({ ref: entry.ref });
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        throw new Error("That file isn't valid JSON.");
      }
      if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as SchematicFile).nodes)) {
        throw new Error("That file doesn't look like a schematic.");
      }
      store.importFromJSON(parsed as SchematicFile);
      // Bind AFTER import — importFromJSON clears local identity.
      useSchematicStore.getState().setGitRef(entry.ref);
      store.addToast(`Opened ${entry.name} from ${entry.repo === "." ? "git root" : entry.repo}`, "success", 3000);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOpening(null);
    }
  };

  // Group by repository for display.
  const groups = new Map<string, GitFileEntry[]>();
  for (const f of files ?? []) {
    const list = groups.get(f.repo) ?? [];
    list.push(f);
    groups.set(f.repo, list);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white border border-[var(--color-border)] rounded-lg shadow-2xl w-[480px] max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)]">
          <span className="text-sm font-semibold text-[var(--color-text-heading)]">Open from Git</span>
          <button
            onClick={onClose}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-lg leading-none cursor-pointer"
          >
            &times;
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-3">
          {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
          {!files && !error && <p className="text-xs text-[var(--color-text-muted)]">Looking for schematics under the git root…</p>}
          {files && files.length === 0 && (
            <p className="text-xs text-[var(--color-text-muted)]">
              No schematic .json files found inside git repositories under <code>{root}</code>.
            </p>
          )}
          {[...groups.entries()].map(([repo, list]) => (
            <div key={repo} className="mb-3">
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
                {repo === "." ? "(git root)" : repo}
              </div>
              {list.map((f) => (
                <button
                  key={f.ref}
                  disabled={opening !== null}
                  onClick={() => void openRef(f)}
                  className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-[var(--color-surface-hover)] disabled:opacity-50 cursor-pointer flex justify-between gap-3"
                >
                  <span className="truncate text-[var(--color-text)]">
                    {opening === f.ref ? "Opening… " : ""}{f.name}
                  </span>
                  <span className="shrink-0 text-[var(--color-text-muted)]">
                    {new Date(f.modifiedAt).toLocaleDateString()}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
