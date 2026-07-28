/**
 * Normalizes virtual TCP/UDP sub-handles into the shape the app expects: every
 * sub-handle sits directly beneath the network port that hosts it, exactly one
 * level deep.
 *
 * Shared by the device editor (which runs it whenever a device is loaded or
 * saved) and the v49→v50 migration (which repairs whole files on load), so the
 * two can't drift apart.
 */
import { NETWORK_SIGNAL_TYPES, isVirtualSignal } from "./connectorTypes";
import type { SignalType } from "./types";

interface PortLike {
  id: string;
  signalType: SignalType;
  parentPortId?: string;
}

/**
 * Returns `ports` reordered so each sub-handle follows its parent, with these
 * repairs applied:
 *
 * - a sub-handle pointing at another sub-handle is re-parented to a real network
 *   port (multi-level chains collapse to one level);
 * - a virtual port with no parent — or whose parent has been deleted — is adopted
 *   by the nearest network port above it;
 * - a non-virtual port never keeps a parent link.
 *
 * A virtual port with no network port to host it is left where it is rather than
 * dropped, so nothing is silently lost.
 */
export function groupSubHandles<T extends PortLike>(ports: T[]): T[] {
  const byId = new Map(ports.map((p) => [p.id, p]));
  const parents: T[] = [];
  const children = new Map<string, T[]>();
  let lastNetwork: string | undefined;

  for (const p of ports) {
    // A parent is only valid if it exists and is not itself a sub-handle.
    const parentOk =
      !!p.parentPortId && byId.has(p.parentPortId) && !byId.get(p.parentPortId)!.parentPortId;

    if (isVirtualSignal(p.signalType)) {
      const host = parentOk ? p.parentPortId! : lastNetwork;
      if (host) {
        const arr = children.get(host) ?? [];
        arr.push(host === p.parentPortId ? p : { ...p, parentPortId: host });
        children.set(host, arr);
        continue;
      }
      // Nothing can host it — fall through and keep it as a top-level port.
    }

    if (NETWORK_SIGNAL_TYPES.has(p.signalType) && !isVirtualSignal(p.signalType)) {
      lastNetwork = p.id;
    }
    parents.push(p.parentPortId ? { ...p, parentPortId: undefined } : p);
  }

  return parents.flatMap((p) => [p, ...(children.get(p.id) ?? [])]);
}

/** True when `ports` is already normalized — lets callers skip a needless rewrite. */
export function isGrouped<T extends PortLike>(ports: T[]): boolean {
  const out = groupSubHandles(ports);
  return (
    out.length === ports.length &&
    out.every((p, i) => p === ports[i])
  );
}
