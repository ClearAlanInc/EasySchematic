/**
 * Rule-checker: scores a routed fixture against the R1–R11 routing rules plus
 * aesthetic metrics. This is the harness's oracle — thresholds here are
 * harness-local on purpose, so the verdict does NOT move when Phase 2 retunes the
 * router's internal constants (SEPARATION_PX, etc.). The router and the checker are
 * deliberately separate measuring sticks.
 *
 * Hard-zero metrics (a clean route must score 0): deviceOverlapCount (R1),
 * nonOrthogonalSegments (R3), unroutedEdges. Everything else is a soft quality
 * metric tracked against a per-fixture baseline.
 */

import type { SchematicNode, ConnectionEdge } from "../types";
import { extractSegments, segmentsCross } from "../edgeRouter";

type Seg = ReturnType<typeof extractSegments>[number];

/** Harness-local geometry thresholds (pixels). */
const SHARED_PX = 8; // parallel segments closer than this (and overlapping > this) are "shared"
const CROSS_TYPE_PX = 16; // different-signal verticals closer than this are under-separated (R11)
const DEVICE_INSET = 2; // shrink device body before testing interior intersection (handles sit on the edge)
const MAX_OFFENDERS = 25;

export interface RuleReport {
  fixture: string;
  deviceCount: number;
  edgeCount: number;
  routedCount: number;
  overBudget: boolean;
  metrics: Record<string, number>;
  offenders: Record<string, string[]>;
  warnings: string[];
}

interface DeviceRect {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function absPos(node: SchematicNode, map: Map<string, SchematicNode>) {
  let x = node.position.x;
  let y = node.position.y;
  let parentId = node.parentId;
  while (parentId) {
    const parent = map.get(parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }
  return { x, y };
}

function deviceRects(nodes: SchematicNode[], map: Map<string, SchematicNode>): DeviceRect[] {
  const rects: DeviceRect[] = [];
  for (const n of nodes) {
    if (n.type !== "device") continue;
    const pos = absPos(n, map);
    const w = n.measured?.width ?? 180;
    const h = n.measured?.height ?? 60;
    rects.push({ id: n.id, left: pos.x, top: pos.y, right: pos.x + w, bottom: pos.y + h });
  }
  return rects;
}

/** Does an axis-aligned segment pass through the interior of a rect (inset to ignore edge grazing)? */
function segmentEntersRect(seg: Seg, r: DeviceRect): boolean {
  const l = r.left + DEVICE_INSET;
  const t = r.top + DEVICE_INSET;
  const rr = r.right - DEVICE_INSET;
  const b = r.bottom - DEVICE_INSET;
  if (l >= rr || t >= b) return false;
  if (seg.axis === "h") {
    const y = seg.y1;
    if (y <= t || y >= b) return false;
    const lo = Math.min(seg.x1, seg.x2);
    const hi = Math.max(seg.x1, seg.x2);
    return Math.max(lo, l) < Math.min(hi, rr);
  } else {
    const x = seg.x1;
    if (x <= l || x >= rr) return false;
    const lo = Math.min(seg.y1, seg.y2);
    const hi = Math.max(seg.y1, seg.y2);
    return Math.max(lo, t) < Math.min(hi, b);
  }
}

function parallelOverlap(a: Seg, b: Seg, gap: number): boolean {
  if (a.axis !== b.axis) return false;
  if (a.axis === "v") {
    if (Math.abs(a.x1 - b.x1) >= gap) return false;
    const overlap = Math.min(Math.max(a.y1, a.y2), Math.max(b.y1, b.y2)) -
      Math.max(Math.min(a.y1, a.y2), Math.min(b.y1, b.y2));
    return overlap > SHARED_PX;
  } else {
    if (Math.abs(a.y1 - b.y1) >= gap) return false;
    const overlap = Math.min(Math.max(a.x1, a.x2), Math.max(b.x1, b.x2)) -
      Math.max(Math.min(a.x1, a.x2), Math.min(b.x1, b.x2));
    return overlap > SHARED_PX;
  }
}

interface EdgeGeom {
  edgeId: string;
  signalType?: string;
  segs: Seg[];
  source: { x: number; y: number };
  target: { x: number; y: number };
  srcNode: string;
  tgtNode: string;
}

export function computeRuleReport(opts: {
  fixture: string;
  nodes: SchematicNode[];
  edges: ConnectionEdge[];
  routes: Record<string, { waypoints: { x: number; y: number }[]; turns?: string }>;
  overBudget: boolean;
}): RuleReport {
  const { fixture, nodes, edges, routes, overBudget } = opts;
  const map = new Map<string, SchematicNode>();
  for (const n of nodes) map.set(n.id, n);
  const rects = deviceRects(nodes, map);

  const geoms: EdgeGeom[] = [];
  const unrouted: string[] = [];
  for (const e of edges) {
    const route = routes[e.id];
    if (!route || route.waypoints.length < 2) {
      unrouted.push(e.id);
      continue;
    }
    const segs = extractSegments(route.waypoints);
    geoms.push({
      edgeId: e.id,
      signalType: e.data?.signalType,
      segs,
      source: route.waypoints[0],
      target: route.waypoints[route.waypoints.length - 1],
      srcNode: e.source,
      tgtNode: e.target,
    });
  }

  const offenders: Record<string, string[]> = {};
  const add = (key: string, id: string) => {
    (offenders[key] ??= []).push(id);
  };

  // ---- R1: device body crossings ----
  let deviceOverlapCount = 0;
  for (const g of geoms) {
    let hit = false;
    for (const r of rects) {
      if (r.id === g.srcNode || r.id === g.tgtNode) continue;
      if (g.segs.some((s) => segmentEntersRect(s, r))) {
        hit = true;
        break;
      }
    }
    if (hit) {
      deviceOverlapCount++;
      add("deviceOverlap", g.edgeId);
    }
  }

  // ---- R2: handle arrivals must be horizontal ----
  let nonHorizontalArrivals = 0;
  // ---- R3: orthogonality ----
  let nonOrthogonalSegments = 0;
  // turns / detour / backward
  let turnsTotal = 0;
  let turnsMax = 0;
  let detourMax = 0;
  let detourSum = 0;
  let backwardSegments = 0;
  for (const g of geoms) {
    if (g.segs.length > 0) {
      if (g.segs[0].axis !== "h") {
        nonHorizontalArrivals++;
        add("nonHorizontalArrival", g.edgeId);
      }
      if (g.segs[g.segs.length - 1].axis !== "h") {
        nonHorizontalArrivals++;
        add("nonHorizontalArrival", g.edgeId);
      }
    }
    for (const s of g.segs) {
      if (s.x1 !== s.x2 && s.y1 !== s.y2) {
        nonOrthogonalSegments++;
        add("nonOrthogonal", g.edgeId);
      }
    }
    let turns = 0;
    for (let i = 0; i < g.segs.length - 1; i++) {
      if (g.segs[i].axis !== g.segs[i + 1].axis) turns++;
    }
    turnsTotal += turns;
    turnsMax = Math.max(turnsMax, turns);

    const pathLen = g.segs.reduce(
      (sum, s) => sum + Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1),
      0,
    );
    const manhattan = Math.abs(g.target.x - g.source.x) + Math.abs(g.target.y - g.source.y);
    const ratio = pathLen / Math.max(manhattan, 1);
    detourMax = Math.max(detourMax, ratio);
    detourSum += ratio;

    const forward = g.target.x > g.source.x;
    if (forward) {
      for (const s of g.segs) {
        if (s.axis === "h" && s.x2 < s.x1) backwardSegments++;
      }
    }
  }

  // ---- R5/R6: shared parallel segments; crossings; weaving; R11 cross-type ----
  let sharedParallel = 0;
  let crossingPairs = 0;
  let weavingPairs = 0;
  let crossTypeSep = 0;
  for (let i = 0; i < geoms.length; i++) {
    for (let j = i + 1; j < geoms.length; j++) {
      const a = geoms[i];
      const b = geoms[j];
      let shared = false;
      let crossCount = 0;
      let crossType = false;
      for (const sa of a.segs) {
        for (const sb of b.segs) {
          if (parallelOverlap(sa, sb, SHARED_PX)) shared = true;
          if (segmentsCross(sa, sb)) crossCount++;
          if (
            sa.axis === "v" &&
            sb.axis === "v" &&
            a.signalType !== b.signalType &&
            parallelOverlap(sa, sb, CROSS_TYPE_PX) &&
            !parallelOverlap(sa, sb, SHARED_PX)
          ) {
            crossType = true;
          }
        }
      }
      if (shared) {
        sharedParallel++;
        add("sharedParallel", `${a.edgeId}|${b.edgeId}`);
      }
      if (crossCount >= 1) crossingPairs++;
      if (crossCount >= 2) {
        weavingPairs++;
        add("weaving", `${a.edgeId}|${b.edgeId}`);
      }
      if (crossType) {
        crossTypeSep++;
        add("crossTypeSep", `${a.edgeId}|${b.edgeId}`);
      }
    }
  }

  // ---- fallback routes ----
  let fallbackCount = 0;
  for (const e of edges) {
    const t = routes[e.id]?.turns;
    if (typeof t === "string" && /fallback/i.test(t)) {
      fallbackCount++;
      add("fallback", e.id);
    }
  }

  // Trim offender lists for readability.
  for (const k of Object.keys(offenders)) {
    if (offenders[k].length > MAX_OFFENDERS) {
      const extra = offenders[k].length - MAX_OFFENDERS;
      offenders[k] = offenders[k].slice(0, MAX_OFFENDERS);
      offenders[k].push(`… +${extra} more`);
    }
  }

  // ---- track-assignment quality (Phase-0 engine metrics) ----
  // channelDensity = max number of vertical trunk segments overlapping in Y within a
  // narrow X window (~one channel). This is the lower bound on tracks (the clique number
  // of the interval graph); a routed result whose distinct trunk-X count near a band
  // greatly exceeds density signals poor packing. distinctTrackXs = total distinct
  // vertical-segment X positions. doglegCount = routes whose trunk was split to break a
  // vertical-constraint cycle (0 until Phase 3 lands doglegs).
  const verticalSegs = geoms.flatMap((g) =>
    g.segs.filter((s) => s.axis === "v").map((s) => ({
      x: s.x1, yMin: Math.min(s.y1, s.y2), yMax: Math.max(s.y1, s.y2),
    })),
  );
  let channelDensity = 0;
  for (const v of verticalSegs) {
    let c = 0;
    for (const w of verticalSegs) {
      if (Math.abs(w.x - v.x) <= 40 && w.yMax >= v.yMin && w.yMin <= v.yMax) c++;
    }
    channelDensity = Math.max(channelDensity, c);
  }
  const distinctTrackXs = new Set(verticalSegs.map((v) => v.x)).size;
  const doglegCount = edges.filter((e) => /dogleg/i.test(String(routes[e.id]?.turns ?? ""))).length;

  const routedCount = geoms.length;
  const warnings: string[] = [];
  if (overBudget) warnings.push("routing exceeded time budget (partial/fallback routes)");
  if (unrouted.length) warnings.push(`${unrouted.length} edge(s) produced no route`);

  return {
    fixture,
    deviceCount: rects.length,
    edgeCount: edges.length,
    routedCount,
    overBudget,
    metrics: {
      deviceOverlapCount,
      nonHorizontalArrivals,
      nonOrthogonalSegments,
      sharedParallelSegments: sharedParallel,
      crossingPairs,
      weavingPairs,
      crossTypeSepViolations: crossTypeSep,
      backwardSegments,
      turnsTotal,
      turnsMax,
      detourRatioMax: Math.round(detourMax * 1000) / 1000,
      detourRatioMean: routedCount ? Math.round((detourSum / routedCount) * 1000) / 1000 : 0,
      fallbackCount,
      unroutedEdges: unrouted.length,
      channelDensity,
      distinctTrackXs,
      doglegCount,
    },
    offenders,
    warnings,
  };
}

/** Metrics that must be exactly 0 for a routing run to be considered correct. */
export const HARD_ZERO_METRICS = [
  "deviceOverlapCount",
  "nonOrthogonalSegments",
  "unroutedEdges",
] as const;
