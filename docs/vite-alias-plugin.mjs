/**
 * Vite plugin that redirects imports from the main app's src/ modules
 * to docs-specific shims. Works for both client and SSR builds.
 */
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Normalize path separators for comparison
const norm = (p) => p.replace(/\\/g, "/");

const appSrc = norm(path.resolve(__dirname, "../src"));
const shimDir = norm(path.resolve(__dirname, "src"));

const SHIMS = {
  "store": "storeShim.ts",
  "signalColors": "signalColorsShim.ts",
  "migrations": "migrationsShim.ts",
  "alignUtils": "alignUtilsShim.ts",
};

export default function appShimPlugin() {
  return {
    name: "easyschematic-shim-alias",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer) return null;

      // Only intercept relative imports that resolve to the main app's src/
      // Check if the resolved path would land in appSrc
      const normalizedImporter = norm(importer);

      // For bare module names in the form "../store" or "./store"
      // Try to resolve manually
      if (!source.startsWith(".")) return null;

      const importerDir = path.dirname(normalizedImporter);
      const resolved = norm(path.resolve(importerDir, source));

      for (const [mod, shim] of Object.entries(SHIMS)) {
        const target = appSrc + "/" + mod;
        if (resolved === target || resolved === target + ".ts") {
          return shimDir + "/" + shim;
        }
      }

      return null;
    },
  };
}
