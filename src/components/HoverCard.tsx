import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * Floating hover card anchored to the cursor, rendered into document.body so it
 * can never be clipped by node bounds or the canvas transform. Used by the
 * port and wire hover details (#hover-features).
 */
export function HoverCard({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  // Offset from the cursor, clamped so the card stays on screen.
  const pad = 14;
  const maxW = 300;
  const left = Math.min(x + pad, window.innerWidth - maxW - 8);
  const flipUp = y > window.innerHeight - 220;
  return createPortal(
    <div
      style={{
        position: "fixed",
        left,
        top: flipUp ? undefined : y + pad,
        bottom: flipUp ? window.innerHeight - y + pad : undefined,
        maxWidth: maxW,
        zIndex: 10000,
        pointerEvents: "none",
      }}
      className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg px-2.5 py-2 text-[11px] leading-snug text-[var(--color-text)]"
    >
      {children}
    </div>,
    document.body,
  );
}

/** One label/value line inside a hover card. Values render dimmer than labels. */
export function HoverRow({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <div className="flex gap-2 justify-between items-baseline">
      <span className="text-[var(--color-text-muted)] shrink-0">{label}</span>
      <span className="text-right truncate" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

/** Card title with an optional signal-colored dot. */
export function HoverTitle({ text, dotColor }: { text: string; dotColor?: string }) {
  return (
    <div className="flex items-center gap-1.5 font-semibold mb-1">
      {dotColor && <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: dotColor }} />}
      <span className="truncate">{text}</span>
    </div>
  );
}
