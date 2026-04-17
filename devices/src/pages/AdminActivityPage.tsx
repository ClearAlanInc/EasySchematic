import { useState, useEffect } from "react";
import { fetchModActivity, fetchModerators } from "../api";
import type { ModAction, ModeratorSummary } from "../api";
import { linkClick } from "../navigate";

const ACTION_COLORS: Record<string, string> = {
  approve: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  reject: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  defer: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
};

function RelativeTime({ iso }: { iso: string }) {
  const ms = Date.now() - new Date(iso + "Z").getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return <span>just now</span>;
  if (mins < 60) return <span>{mins}m ago</span>;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return <span>{hours}h ago</span>;
  const days = Math.floor(hours / 24);
  return <span>{days}d ago</span>;
}

function DataDiff({ before, after }: { before: string; after: string }) {
  try {
    const b = JSON.parse(before);
    const a = JSON.parse(after);
    const allKeys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
    const changed = allKeys.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
    if (changed.length === 0) return <span className="text-slate-400 dark:text-slate-500 text-xs">No field changes</span>;

    return (
      <div className="text-xs space-y-1 max-h-64 overflow-y-auto">
        {changed.map((key) => (
          <div key={key} className="grid grid-cols-[120px_1fr_1fr] gap-1">
            <span className="font-medium text-slate-600 dark:text-slate-300 truncate">{key}</span>
            <span className="text-red-600 dark:text-red-400 truncate bg-red-50 dark:bg-red-900/20 px-1 rounded">
              {b[key] !== undefined ? truncateVal(b[key]) : "—"}
            </span>
            <span className="text-green-600 dark:text-green-400 truncate bg-green-50 dark:bg-green-900/20 px-1 rounded">
              {a[key] !== undefined ? truncateVal(a[key]) : "—"}
            </span>
          </div>
        ))}
      </div>
    );
  } catch {
    return <span className="text-slate-400 dark:text-slate-500 text-xs">Could not parse diff</span>;
  }
}

function truncateVal(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 80 ? s.slice(0, 77) + "..." : s;
}

export default function AdminActivityPage() {
  const [actions, setActions] = useState<ModAction[]>([]);
  const [moderators, setModerators] = useState<ModeratorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedMod, setSelectedMod] = useState("");
  const [selectedAction, setSelectedAction] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    fetchModerators()
      .then(setModerators)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError("");
    fetchModActivity({
      moderatorId: selectedMod || undefined,
      action: selectedAction || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    })
      .then((data) => { setActions(data); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [selectedMod, selectedAction, page]);

  const resetFilters = () => {
    setSelectedMod("");
    setSelectedAction("");
    setPage(0);
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Moderator Activity</h1>
        <a href="/admin/users" onClick={linkClick} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
          Manage Users
        </a>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={selectedMod}
          onChange={(e) => { setSelectedMod(e.target.value); setPage(0); }}
          className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All moderators</option>
          {moderators.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name || m.email} ({m.role})
            </option>
          ))}
        </select>

        <select
          value={selectedAction}
          onChange={(e) => { setSelectedAction(e.target.value); setPage(0); }}
          className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All actions</option>
          <option value="approve">Approvals</option>
          <option value="reject">Rejections</option>
          <option value="defer">Deferrals</option>
        </select>

        {(selectedMod || selectedAction) && (
          <button
            onClick={resetFilters}
            className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            Clear filters
          </button>
        )}
      </div>

      {error && <div className="p-4 text-center text-red-600 dark:text-red-400">{error}</div>}
      {loading && <div className="p-8 text-center text-slate-500 dark:text-slate-400">Loading...</div>}

      {!loading && !error && actions.length === 0 && (
        <div className="text-center py-12 text-slate-500 dark:text-slate-400">
          No moderator activity {selectedMod || selectedAction ? "matching these filters" : "yet"}.
        </div>
      )}

      {!loading && !error && actions.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-left">
                  <th className="py-2 px-3 font-medium text-slate-500 dark:text-slate-400">When</th>
                  <th className="py-2 px-3 font-medium text-slate-500 dark:text-slate-400">Moderator</th>
                  <th className="py-2 px-3 font-medium text-slate-500 dark:text-slate-400">Action</th>
                  <th className="py-2 px-3 font-medium text-slate-500 dark:text-slate-400">Device</th>
                  <th className="py-2 px-3 font-medium text-slate-500 dark:text-slate-400">Note</th>
                  <th className="py-2 px-3 font-medium text-slate-500 dark:text-slate-400"></th>
                </tr>
              </thead>
              <tbody>
                {actions.map((a) => {
                  const deviceLabel = getDeviceLabel(a);
                  const hasDetails = a.before_data || a.after_data || a.submission_data_override;
                  const isExpanded = expandedId === a.id;

                  return (
                    <tr key={a.id} className="border-b border-slate-100 dark:border-slate-800 align-top">
                      <td className="py-2 px-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        <RelativeTime iso={a.created_at} />
                        <div className="text-xs text-slate-400 dark:text-slate-500">
                          {new Date(a.created_at + "Z").toLocaleDateString()}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-slate-700 dark:text-slate-200">
                        {a.moderator_name || a.moderator_email}
                      </td>
                      <td className="py-2 px-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_COLORS[a.action] || ""}`}>
                          {a.action}
                        </span>
                        {a.submission_action && (
                          <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">
                            ({a.submission_action})
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-slate-700 dark:text-slate-200 max-w-[200px] truncate">
                        {deviceLabel}
                      </td>
                      <td className="py-2 px-3 text-slate-500 dark:text-slate-400 max-w-[200px] truncate">
                        {a.note || "—"}
                      </td>
                      <td className="py-2 px-3">
                        {hasDetails && (
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : a.id)}
                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                          >
                            {isExpanded ? "Hide" : "Details"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Expanded detail panel renders below the table for cleanliness */}
          {expandedId && (() => {
            const a = actions.find((x) => x.id === expandedId);
            if (!a) return null;
            return (
              <div className="mt-2 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    Action #{a.id} — {a.action} by {a.moderator_name || a.moderator_email}
                  </h3>
                  <button
                    onClick={() => setExpandedId(null)}
                    className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    Close
                  </button>
                </div>

                {a.submission_data_override && (
                  <div className="mb-3">
                    <h4 className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Moderator edits to submission before approval</h4>
                    <pre className="text-xs bg-white dark:bg-slate-900 p-2 rounded overflow-x-auto max-h-32 text-slate-700 dark:text-slate-300">
                      {formatJson(a.submission_data_override)}
                    </pre>
                  </div>
                )}

                {a.before_data && a.after_data && (
                  <div>
                    <h4 className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Template changes (before → after)</h4>
                    <DataDiff before={a.before_data} after={a.after_data} />
                  </div>
                )}

                {!a.before_data && a.after_data && (
                  <div>
                    <h4 className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">New template data</h4>
                    <pre className="text-xs bg-white dark:bg-slate-900 p-2 rounded overflow-x-auto max-h-48 text-slate-700 dark:text-slate-300">
                      {formatJson(a.after_data)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Pagination */}
          <div className="flex justify-between items-center mt-4">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="text-sm px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
            >
              Previous
            </button>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              Page {page + 1}{actions.length < PAGE_SIZE ? " (last)" : ""}
            </span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={actions.length < PAGE_SIZE}
              className="text-sm px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function getDeviceLabel(a: ModAction): string {
  try {
    const data = a.after_data ? JSON.parse(a.after_data) : null;
    if (data?.label) return data.label;
  } catch {}
  try {
    const data = a.before_data ? JSON.parse(a.before_data) : null;
    if (data?.label) return data.label;
  } catch {}
  return a.template_id ? `Template ${a.template_id.slice(0, 8)}...` : "—";
}

function formatJson(s: string): string {
  try { return JSON.stringify(JSON.parse(s), null, 2); }
  catch { return s; }
}
