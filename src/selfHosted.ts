/**
 * Self-hosted / fully-offline build configuration — the single source of truth
 * for every external-service URL and cloud-feature gate.
 *
 * Semantics (see docs "Self-Hosting"):
 *
 * | VITE_SELF_HOSTED | VITE_TEMPLATE_API_URL | Behavior                                        |
 * |------------------|-----------------------|-------------------------------------------------|
 * | unset            | unset                 | Hosted default (api.easyschematic.live)         |
 * | unset            | set                   | Cloud UI against the custom API                 |
 * | "true" / "1"     | unset                 | Fully offline: no automatic external contact,   |
 * |                  |                       | cloud + community-submit UI hidden              |
 * | "true" / "1"     | set                   | Self-hosted app + self-hosted API: cloud UI on, |
 * |                  |                       | but no other external defaults                  |
 *
 * IMPORTANT: import.meta.env values are strings — always compare against the
 * literal, never rely on truthiness ("false" is truthy).
 */

const rawFlag = import.meta.env?.VITE_SELF_HOSTED;

/** True when this build was made with VITE_SELF_HOSTED=true (or =1). */
export const IS_SELF_HOSTED = rawFlag === "true" || rawFlag === "1";

// `|| undefined` (not `??`): Docker build-args that aren't provided arrive as
// SET-BUT-EMPTY env vars, and an empty string must mean "unset" here.
const envApiUrl = import.meta.env?.VITE_TEMPLATE_API_URL || undefined;
const envDevicesUrl = import.meta.env?.VITE_DEVICES_URL || undefined;
const envDocsUrl = import.meta.env?.VITE_DOCS_URL || undefined;

/**
 * Base URL of the schematic/auth/template API. Empty string in a fully-offline
 * build — every network-touching function must check CLOUD_ENABLED before use,
 * so the empty sentinel is never fetched.
 */
export const API_URL: string =
  envApiUrl ?? (IS_SELF_HOSTED ? "" : "https://api.easyschematic.live");

/**
 * Base URL of the community device-database site (links + submission hand-off
 * target only — never fetched). Empty string hides those links entirely.
 */
export const DEVICES_URL: string =
  envDevicesUrl ?? (IS_SELF_HOSTED ? "" : "https://devices.easyschematic.live");

/**
 * Base URL of the documentation site (links only — never fetched). Empty
 * string hides every docs link, keeping fully-offline builds free of
 * external references.
 */
export const DOCS_URL: string =
  envDocsUrl ?? (IS_SELF_HOSTED ? "" : "https://docs.easyschematic.live");

/**
 * Master gate for everything that talks to the API: auth, cloud schematics,
 * shared links, and the community-library fetch. When false, the app runs
 * entirely from the bundled device library and local storage.
 */
export const CLOUD_ENABLED = !IS_SELF_HOSTED || API_URL !== "";

/**
 * Gate for the "Submit to Community" flows, which need both the API (drafts /
 * auth hand-off) and the devices site (the submission UI it opens).
 */
export const SUBMIT_ENABLED = CLOUD_ENABLED && DEVICES_URL !== "";
