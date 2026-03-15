/**
 * Shim for src/alignUtils.ts.
 */
export type AlignOperation =
  | "align-left"
  | "align-center-h"
  | "align-right"
  | "align-top"
  | "align-center-v"
  | "align-bottom"
  | "distribute-h"
  | "distribute-v";

export function computeAlignment(): Map<string, { x: number; y: number }> {
  return new Map();
}
