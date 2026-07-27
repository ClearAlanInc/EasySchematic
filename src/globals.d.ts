/// <reference types="vite-plugin-pwa/client" />

// Augments Vite's ImportMetaEnv (interface merging — do not redeclare ImportMeta).
interface ImportMetaEnv {
  /** "true" / "1" = self-hosted build: no external defaults, cloud UI gated (see src/selfHosted.ts) */
  readonly VITE_SELF_HOSTED?: string;
  /** Override for the schematic/auth/template API base URL */
  readonly VITE_TEMPLATE_API_URL?: string;
  /** Override for the community device-database site URL (links only, never fetched) */
  readonly VITE_DEVICES_URL?: string;
}

declare const __APP_VERSION__: string;
declare const __BUILD_HASH__: string;

// File System Access API (Chromium only)
interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
}

interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[];
  multiple?: boolean;
}

interface Window {
  showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
  showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
}
