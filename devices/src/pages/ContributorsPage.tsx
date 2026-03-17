import { useState, useEffect } from "react";
import { fetchContributors } from "../api";
import type { Contributor } from "../api";

export default function ContributorsPage() {
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchContributors()
      .then(setContributors)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-center text-slate-500">Loading...</div>;
  if (error) return <div className="p-8 text-center text-red-600">{error}</div>;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Contributors</h1>
      <p className="text-sm text-slate-500 mb-6">
        The people building the EasySchematic device library.
      </p>

      {contributors.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <p className="mb-2">No contributions yet.</p>
          <a href="#/submit" className="text-sm text-blue-600 hover:text-blue-800">Be the first!</a>
        </div>
      ) : (
        <div className="space-y-2">
          {contributors.map((c, i) => (
            <div
              key={c.id}
              className="flex items-center gap-4 p-4 rounded-lg border border-slate-200 bg-white"
            >
              <div className="flex-shrink-0 w-8 text-center">
                {i === 0 ? (
                  <span className="text-xl">&#x1F947;</span>
                ) : i === 1 ? (
                  <span className="text-xl">&#x1F948;</span>
                ) : i === 2 ? (
                  <span className="text-xl">&#x1F949;</span>
                ) : (
                  <span className="text-sm font-bold text-slate-400">#{i + 1}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-900 truncate">{c.name}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-slate-900">{c.approvedCount}</p>
                <p className="text-xs text-slate-500">{c.approvedCount === 1 ? "device" : "devices"}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
