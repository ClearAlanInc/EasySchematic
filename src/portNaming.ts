import type { PortDirection } from "./types";

const BASE_FOR_DIRECTION: Partial<Record<PortDirection, string>> = {
  input: "Input",
  output: "Output",
  bidirectional: "Bidir",
  passthrough: "Passthrough",
};

/**
 * Fill in a name for any port left blank in the device editor. Unnamed ports used
 * to be silently dropped on save (confusing — a row you added just vanished);
 * instead we auto-name them "<Direction> N", numbered per direction and
 * de-duplicated against names already in use, so nothing disappears. Already-named
 * ports are returned with their label trimmed and otherwise untouched.
 */
export function autoNamePorts<T extends { label: string; direction: PortDirection }>(
  ports: T[],
): T[] {
  const used = new Set(ports.map((p) => p.label.trim()).filter(Boolean));
  const counters: Partial<Record<PortDirection, number>> = {};
  return ports.map((p) => {
    const trimmed = p.label.trim();
    if (trimmed) return { ...p, label: trimmed };

    const base = BASE_FOR_DIRECTION[p.direction] ?? "Port";
    let n = (counters[p.direction] ?? 0) + 1;
    let name = `${base} ${n}`;
    while (used.has(name)) {
      n++;
      name = `${base} ${n}`;
    }
    counters[p.direction] = n;
    used.add(name);
    return { ...p, label: name };
  });
}
