/**
 * Main-thread client for the routing Web Worker POOL — portfolio search.
 *
 * Each routing request fans out to the diversified candidate set (portfolio.ts): one sub-job per
 * candidate, dispatched across a pool of workers. Every worker routes its candidate and SELF-SCORES
 * (shared objective, scoreRoutes). When all of the latest request's candidates have returned, the
 * client picks the lowest-scoring (cleanest) result — ties resolve to the earliest candidate, i.e.
 * the shipped default — and hands exactly that one back. The result shape and the
 * requestRoutes / setRoutingResultHandler API are unchanged, so the store is oblivious to the
 * portfolio: it still gets one RoutingResult per seq.
 *
 * Coalescing is at the request (seq) level: a newer request supersedes the older one — queued
 * stale candidates are dropped, in-flight ones complete but are discarded. If no Worker exists (or
 * one crashes), the whole portfolio runs synchronously on the main thread — identical winner, just
 * no offload.
 */

import type { SchematicNode, ConnectionEdge, BundleMeta } from "../types";
import { routeAllEdges, type RoutedEdge } from "../edgeRouter";
import { scoreRoutes } from "./scoreRoutes";
import { ROUTING_CANDIDATES } from "./portfolio";
import type { HandleSnapshot } from "./handleSnapshot";

export interface RoutingRequest {
  /** Caller-assigned monotonic id; echoed back so the caller can discard stale results. */
  seq: number;
  nodes: SchematicNode[];
  edges: ConnectionEdge[];
  handles: HandleSnapshot;
  bundles: Record<string, BundleMeta>;
  debug: boolean;
  opsBudget?: number;
  /** window.__routingParams snapshot (live tuning overrides) — re-applied inside the worker. */
  routingParams?: Record<string, number>;
  /** Set per sub-job by the portfolio dispatcher; identifies which candidate produced this run. */
  candidateLabel?: string;
}

export interface RoutingResult {
  seq: number;
  routes: Record<string, RoutedEdge>;
  overBudget: boolean;
  /** Objective score of this candidate's routing (lower = cleaner). Set by the worker/sync scorer. */
  score: number;
  /** Which portfolio candidate produced this result. */
  candidateLabel?: string;
  /** __routingDebug (overlay) + __routingReport (copy-report button), ferried from the worker. */
  routingDebug: unknown;
  routingReport: unknown;
}

type ResultHandler = (r: RoutingResult) => void;

let handler: ResultHandler | null = null;

/** Register the (single) callback invoked when the winning routing result for a request arrives. */
export function setRoutingResultHandler(cb: ResultHandler): void {
  handler = cb;
}

// ---------- Worker pool ----------
// No more workers than candidates; leave cores for the main thread + rendering.
const POOL_SIZE = Math.min(
  ROUTING_CANDIDATES.length,
  Math.max(2, ((typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4) - 2),
);

let pool: Worker[] = [];
let idle: Worker[] = [];
let poolUnavailable = false;

// Candidate label → its index in ROUTING_CANDIDATES (default is 0), for tie-breaking toward default.
const candIndex = new Map(ROUTING_CANDIDATES.map((c, i) => [c.label, i] as const));

// ---------- Dispatch state (only the latest request's portfolio is live) ----------
let latestMasterReq: RoutingRequest | null = null;
let latestSeq = -1;
let expectedForSeq = 0;
let collected: RoutingResult[] = [];
let awaiting = false;
let jobQueue: RoutingRequest[] = [];

function teardownPool(): void {
  for (const w of pool) { try { w.terminate(); } catch { /* ignore */ } }
  pool = [];
  idle = [];
}

function ensurePool(): boolean {
  if (poolUnavailable) return false;
  if (pool.length > 0) return true;
  if (typeof Worker === "undefined") {
    poolUnavailable = true;
    return false;
  }
  try {
    for (let i = 0; i < POOL_SIZE; i++) {
      const w = new Worker(new URL("./routing.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (ev: MessageEvent<RoutingResult>) => onWorkerResult(w, ev.data);
      w.onerror = onWorkerError;
      pool.push(w);
      idle.push(w);
    }
    return true;
  } catch {
    teardownPool();
    poolUnavailable = true;
    return false;
  }
}

function onWorkerError(): void {
  // A worker crashed — abandon the pool, fall back to sync for the rest of the session, and re-run
  // the latest request synchronously so the caller's isRouting state can't stick.
  teardownPool();
  poolUnavailable = true;
  jobQueue = [];
  collected = [];
  awaiting = false;
  const req = latestMasterReq;
  if (req) runSyncPortfolio(req);
}

function pump(): void {
  while (idle.length > 0 && jobQueue.length > 0) {
    const job = jobQueue.shift()!;
    const w = idle.shift()!;
    w.postMessage(job);
  }
}

function onWorkerResult(w: Worker, res: RoutingResult): void {
  idle.push(w);
  // Discard stale results (from a superseded request); only the latest seq's portfolio is live.
  if (awaiting && res.seq === latestSeq) {
    collected.push(res);
    if (collected.length >= expectedForSeq) {
      awaiting = false;
      const best = pickBestResult(collected);
      collected = [];
      if (best && handler) handler(best);
    }
  }
  pump();
}

/** Lowest score wins; ties resolve to the earliest candidate (so a tie keeps the default). */
function pickBestResult(results: RoutingResult[]): RoutingResult | null {
  let best: RoutingResult | null = null;
  let bestIdx = Infinity;
  for (const r of results) {
    const idx = candIndex.get(r.candidateLabel ?? "") ?? Number.MAX_SAFE_INTEGER;
    if (best === null || r.score < best.score || (r.score === best.score && idx < bestIdx)) {
      best = r;
      bestIdx = idx;
    }
  }
  return best;
}

/** Build one sub-request per candidate: merge the candidate's params over any live tuning params. */
function buildSubJobs(req: RoutingRequest): RoutingRequest[] {
  return ROUTING_CANDIDATES.map((c) => ({
    ...req,
    candidateLabel: c.label,
    routingParams: { ...(req.routingParams ?? {}), ...c.params },
  }));
}

function runSyncPortfolio(req: RoutingRequest): void {
  // Main-thread fallback: route every candidate, score, pick best. Slower (no offload) but identical.
  const g = globalThis as Record<string, unknown>;
  const results: RoutingResult[] = [];
  for (const c of ROUTING_CANDIDATES) {
    g.__routingParams = { ...(req.routingParams ?? {}), ...c.params };
    const { routes, overBudget } = routeAllEdges(
      req.nodes, req.edges, req.handles, req.debug, undefined, req.opsBudget, req.bundles,
    );
    results.push({
      seq: req.seq,
      candidateLabel: c.label,
      score: scoreRoutes(req.nodes, req.edges, routes),
      routes,
      overBudget,
      routingDebug: g.__routingDebug ?? null,
      routingReport: g.__routingReport ?? null,
    });
  }
  const best = pickBestResult(results);
  // Keep the async shape so the caller's apply path is uniform whether or not a worker exists.
  queueMicrotask(() => { if (best && handler) handler(best); });
}

/** Queue a routing request. Returns immediately; the winning result arrives via the handler. */
export function requestRoutes(req: RoutingRequest): void {
  latestMasterReq = req;
  // Supersede any older in-flight portfolio: drop its queued candidates and reset collection.
  latestSeq = req.seq;
  collected = [];
  jobQueue = [];

  const subs = buildSubJobs(req);
  expectedForSeq = subs.length;

  if (!ensurePool()) {
    awaiting = false;
    runSyncPortfolio(req);
    return;
  }
  awaiting = true;
  jobQueue.push(...subs);
  pump();
}

/** Eagerly spawn the worker pool so the first real route doesn't pay construction latency. */
export function warmupRoutingWorker(): void {
  ensurePool();
}
