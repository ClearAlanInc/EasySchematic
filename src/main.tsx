import { StrictMode, lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import "./index.css";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import { initServiceWorkerUpdates } from "./sw-register";

initServiceWorkerUpdates();

// ---------- PWA file handling ----------
// When the installed PWA is registered as the OS handler for .mcd files
// (manifest file_handlers), opening one launches the app with the file queued
// on window.launchQueue. Consume it: load the drawing and adopt the handle so
// Ctrl+S writes straight back to the opened file. Chromium-only; elsewhere
// launchQueue simply doesn't exist and File → Open remains the path.
interface LaunchQueue {
  setConsumer(consumer: (params: { files?: FileSystemFileHandle[] }) => void): void;
}
const launchQueue = (window as { launchQueue?: LaunchQueue }).launchQueue;
if (launchQueue) {
  launchQueue.setConsumer(async (params) => {
    const handle = params.files?.[0];
    if (!handle) return;
    try {
      const file = await handle.getFile();
      if (file.size > 10 * 1024 * 1024) {
        alert("File is too large (max 10 MB). Please use a smaller schematic file.");
        return;
      }
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        alert("Invalid schematic file.");
        return;
      }
      if (!data || typeof data !== "object" || !Array.isArray((data as { nodes?: unknown }).nodes)) {
        alert("Invalid schematic file.");
        return;
      }
      // A file launch always lands in the editor, not the landing page.
      try { localStorage.setItem("maestro-skip-landing", "1"); } catch { /* fine */ }
      window.dispatchEvent(new CustomEvent("maestro:show-editor"));
      const { useSchematicStore } = await import("./store");
      const store = useSchematicStore.getState();
      store.importFromJSON(data as Parameters<typeof store.importFromJSON>[0]);
      useSchematicStore.getState().adoptLocalFile(handle);
    } catch (e) {
      console.error("Opening launched file failed:", e);
    }
  });
}

const App = lazy(() => import("./App.tsx"));
const LandingPage = lazy(() => import("./components/LandingPage.tsx"));

/** Show landing page at "/" for first-time visitors (no skip pref and no special path). */
function shouldShowLanding(): boolean {
  const path = window.location.pathname;
  // Shared schematic links, or any non-root path — go straight to editor
  if (path !== "/") return false;
  // Returning user who opted to skip the landing page
  if (localStorage.getItem("maestro-skip-landing")) return false;
  return true;
}

function Root() {
  const [showLanding, setShowLanding] = useState(shouldShowLanding);

  // A PWA file launch can arrive while the landing page is up — switch to the
  // editor so the launched drawing is actually visible.
  useEffect(() => {
    const toEditor = () => setShowLanding(false);
    window.addEventListener("maestro:show-editor", toEditor);
    return () => window.removeEventListener("maestro:show-editor", toEditor);
  }, []);

  if (showLanding) {
    return (
      <Suspense fallback={null}>
        <LandingPage />
      </Suspense>
    );
  }
  return (
    <ReactFlowProvider>
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </ReactFlowProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
