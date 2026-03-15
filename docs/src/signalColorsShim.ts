/**
 * Shim for src/signalColors.ts — avoids touching `document` at import time.
 */
import type { SignalType } from "../src/types";

export const DEFAULT_SIGNAL_COLORS: Record<SignalType, string> = {
  sdi: "#2563eb",
  hdmi: "#dc2626",
  ndi: "#16a34a",
  dante: "#ea580c",
  "analog-audio": "#854d0e",
  aes: "#7c3aed",
  usb: "#db2777",
  ethernet: "#0891b2",
  fiber: "#d97706",
  displayport: "#0d9488",
  hdbaset: "#9333ea",
  srt: "#15803d",
  genlock: "#475569",
  gpio: "#78716c",
  rs422: "#6d28d9",
  serial: "#525252",
  thunderbolt: "#4f46e5",
  power: "#a16207",
  custom: "#64748b",
};

export function applySignalColors(_colors: Partial<Record<SignalType, string>>) {}
export function loadSignalColors(): Record<SignalType, string> {
  return { ...DEFAULT_SIGNAL_COLORS };
}
export function saveSignalColors(_colors: Record<SignalType, string>) {}
export function getSignalColorOverrides(
  _colors: Record<SignalType, string>,
): Partial<Record<SignalType, string>> | undefined {
  return undefined;
}
