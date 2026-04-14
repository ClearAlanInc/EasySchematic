import { useEffect, useRef, useState } from "react";
import type MiniSearchModule from "minisearch";
import { navigateTo, getPath } from "../navigate";

interface SearchEntry {
  id: number;
  path: string;
  pageTitle: string;
  heading: string;
  headingSlug: string;
  level: number;
  content: string;
}

interface ResultHit extends SearchEntry {
  matchedTerms: string[];
}

// Lazy, cached loader so the index + MiniSearch are only pulled when the user
// actually starts searching. Both are ~tiny, but it keeps the initial payload lean.
let loader: Promise<{ ms: InstanceType<typeof MiniSearchModule>; byId: Map<number, SearchEntry> }> | null = null;

function loadIndex() {
  if (!loader) {
    loader = (async () => {
      const [{ default: MiniSearch }, indexMod] = await Promise.all([
        import("minisearch"),
        import("../searchIndex.json"),
      ]);
      const entries = (indexMod.default ?? indexMod) as SearchEntry[];
      const ms = new MiniSearch<SearchEntry>({
        fields: ["heading", "pageTitle", "content"],
        storeFields: ["id"],
        searchOptions: {
          boost: { heading: 4, pageTitle: 2 },
          prefix: true,
          fuzzy: 0.2,
          combineWith: "AND",
        },
      });
      ms.addAll(entries);
      const byId = new Map(entries.map((e) => [e.id, e]));
      return { ms, byId };
    })();
  }
  return loader;
}

// Scroll to the heading matching the given text after navigating to its page.
function scrollToHeading(headingText: string) {
  const target = headingText.trim().toLowerCase();
  let tries = 0;
  const tick = () => {
    tries += 1;
    const main = document.querySelector("main");
    if (main) {
      const headings = main.querySelectorAll("h1, h2, h3, h4");
      for (const h of Array.from(headings)) {
        if ((h.textContent ?? "").trim().toLowerCase() === target) {
          h.scrollIntoView({ block: "start", behavior: "auto" });
          (h as HTMLElement).classList.add("bg-yellow-100");
          setTimeout(() => (h as HTMLElement).classList.remove("bg-yellow-100"), 1200);
          return;
        }
      }
    }
    if (tries < 20) requestAnimationFrame(tick); // wait for the page to mount
  };
  requestAnimationFrame(tick);
}

// Wrap each case-insensitive occurrence of any term with a <mark> span.
function highlight(text: string, terms: string[]): (string | JSX.Element)[] {
  if (!terms.length) return [text];
  const escaped = terms
    .filter((t) => t.length >= 2)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!escaped.length) return [text];
  const re = new RegExp(`(${escaped.join("|")})`, "ig");
  const parts = text.split(re);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="bg-yellow-200 text-gray-900 rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function snippet(content: string, terms: string[]): string {
  if (!content) return "";
  if (!terms.length) return content.slice(0, 140) + (content.length > 140 ? "…" : "");
  const lower = content.toLowerCase();
  let best = -1;
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase());
    if (i !== -1 && (best === -1 || i < best)) best = i;
  }
  if (best === -1) return content.slice(0, 140) + (content.length > 140 ? "…" : "");
  const start = Math.max(0, best - 40);
  const end = Math.min(content.length, best + 120);
  return (start > 0 ? "…" : "") + content.slice(start, end) + (end < content.length ? "…" : "");
}

export default function SearchBar() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ResultHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<Awaited<ReturnType<typeof loadIndex>> | null>(null);

  // Warm the index the first time the user focuses the input.
  const warm = async () => {
    if (!stateRef.current) {
      stateRef.current = await loadIndex();
      setLoaded(true);
    }
  };

  // Re-run search whenever the query or the loaded state changes.
  useEffect(() => {
    const q = query.trim();
    if (!q || !stateRef.current) {
      setHits([]);
      return;
    }
    const { ms, byId } = stateRef.current;
    const raw = ms.search(q).slice(0, 8);
    const out: ResultHit[] = [];
    for (const r of raw) {
      const e = byId.get(r.id as number);
      if (e) out.push({ ...e, matchedTerms: (r.terms as string[]) ?? [] });
    }
    setHits(out);
    setActive(0);
  }, [query, loaded]);

  // Click-outside to close dropdown.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const choose = (hit: ResultHit) => {
    const targetPath = hit.path;
    if (getPath() === targetPath || (getPath() === "" && targetPath === "overview")) {
      // already on the page — just scroll
      scrollToHeading(hit.heading);
    } else {
      navigateTo(targetPath);
      scrollToHeading(hit.heading);
    }
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(hits[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={wrapRef} className="relative mb-3 px-1">
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { warm(); setOpen(true); }}
        onKeyDown={onKeyDown}
        placeholder="Search docs..."
        className="w-full bg-white border border-gray-300 rounded px-3 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-gray-400"
        aria-label="Search documentation"
      />
      {open && query.trim() && (
        <div className="absolute left-1 right-1 top-full mt-1 z-50 bg-white border border-gray-200 rounded shadow-lg max-h-[70vh] overflow-y-auto">
          {hits.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-500">
              {loaded ? "No matches." : "Loading…"}
            </div>
          ) : (
            <ul className="py-1">
              {hits.map((h, i) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => { e.preventDefault(); choose(h); }}
                    className={`block w-full text-left px-3 py-2 text-sm ${
                      i === active ? "bg-blue-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="text-xs text-gray-500 truncate">
                      {h.pageTitle}
                      {h.heading !== h.pageTitle && (
                        <>
                          <span className="mx-1 text-gray-300">›</span>
                          <span className="text-gray-700">{highlight(h.heading, h.matchedTerms)}</span>
                        </>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 line-clamp-2 mt-0.5">
                      {highlight(snippet(h.content, h.matchedTerms), h.matchedTerms)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
