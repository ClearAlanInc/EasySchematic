import type { DeviceTemplate } from "./types";
import fallbackData from "./deviceLibrary.fallback.json";

const API_URL =
  import.meta.env.VITE_TEMPLATE_API_URL ?? "https://api.easyschematic.live";

let cached: DeviceTemplate[] | null = null;

export function getBundledTemplates(): DeviceTemplate[] {
  return fallbackData as DeviceTemplate[];
}

export async function fetchTemplates(): Promise<DeviceTemplate[]> {
  if (cached) return cached;

  const res = await fetch(`${API_URL}/templates`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = (await res.json()) as DeviceTemplate[];
  cached = data;
  return data;
}
