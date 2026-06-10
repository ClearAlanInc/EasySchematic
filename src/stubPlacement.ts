// Shared constants + helper for placing stub-label nodes. Used by:
//   - convertEdgeToStubs (store.ts) for newly stubbed connections
//   - migrateStubsToNodes (migrations.ts) for legacy schematics with no stub-end coords
//   - onNodeDrag/onNodeDragStop (App.tsx) to center-snap the box on the 20px grid
//   - StubLabelNode.tsx re-exports the constants for cohesion

import { GRID_SIZE } from "./gridConstants";

export const STUB_GAP = 64;       // gap between device port and the stub box edge facing it
                                  // (large enough for a midpoint cable-ID badge to fit between)
export const STUB_W_EST = 80;     // estimated box width before React Flow has measured the DOM
export const STUB_H_EST = 14;     // estimated box height (9px line-height + 1.5×2 padding + 1×2 border)

/**
 * Snap a stub box top so its connecting HANDLE (vertical center of the box) lands on the
 * nearest grid line. The box is 14px tall with the handle at top+7, so a grid-aligned box
 * TOP puts the handle 7px off-grid — the source of the ~7px endpoint jogs (the paired
 * device port is always on-grid). Bad tops come from legacy saves and stale RF drag-snaps;
 * this is the heal applied on load (and mirrored in the routing harness normalize).
 */
export function snapStubHandleY(top: number, height: number = STUB_H_EST): number {
  const half = height / 2;
  return Math.round((top + half) / GRID_SIZE) * GRID_SIZE - half;
}

/**
 * Place the stub box so the BOX EDGE facing the device is `STUB_GAP` from the
 * device port, and the box CENTER aligns with the port's Y. Returns the absolute
 * top-left position plus which side ("l"|"r") of the box is the connecting handle.
 */
export function defaultStubPlacement(
  handlePos: { x: number; y: number },
  portSide: "left" | "right",
): { pos: { x: number; y: number }; handle: "l" | "r" } {
  if (portSide === "right") {
    // Stub sits to the right of device; connecting handle is on the stub's LEFT side.
    return {
      pos: { x: handlePos.x + STUB_GAP, y: handlePos.y - STUB_H_EST / 2 },
      handle: "l",
    };
  }
  // Stub sits to the left of device; connecting handle is on the stub's RIGHT side.
  return {
    pos: { x: handlePos.x - STUB_GAP - STUB_W_EST, y: handlePos.y - STUB_H_EST / 2 },
    handle: "r",
  };
}
