import { useRef, useState } from "react";
import { useSchematicStore } from "../store";
import { fetchTemplates, getBundledTemplates } from "../templateApi";
import { extractSchematicFromPdf, buildAiImport, type AiImportResult } from "../aiPdfImport";

type Step = "warn" | "running" | "done" | "error";

export default function ImportPdfDialog({ onClose }: { onClose: () => void }) {
  const anthropicApiKey = useSchematicStore((s) => s.anthropicApiKey);
  const setAnthropicApiKey = useSchematicStore((s) => s.setAnthropicApiKey);
  const importAiPdfData = useSchematicStore((s) => s.importAiPdfData);
  const customTemplates = useSchematicStore((s) => s.customTemplates);

  const [step, setStep] = useState<Step>("warn");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<AiImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const runImport = async (file: File) => {
    setStep("running");
    try {
      setStatus("Loading device library…");
      const library = await fetchTemplates().catch(() => getBundledTemplates());
      setStatus("Sending the PDF to Claude…");
      const extraction = await extractSchematicFromPdf(file, anthropicApiKey, (p) => {
        if (p.stage === "analyzing") {
          setStatus(`Claude is reading the drawing… (${Math.round(p.receivedChars / 1024)} KB extracted)`);
        }
      });
      setStatus("Recreating the schematic…");
      const built = buildAiImport(extraction, [...library, ...customTemplates]);
      if (built.pages.length === 0) {
        throw new Error("Claude couldn't find any devices or connections in this document.");
      }
      importAiPdfData(built.pages, built.newTemplates);
      setResult(built);
      setStep("done");
    } catch (err) {
      console.error("AI PDF import failed:", err);
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void runImport(file);
  };

  const btnClass = "px-3 py-1.5 text-xs font-medium rounded border transition-colors";
  const btnPrimary = `${btnClass} bg-blue-500 text-white border-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed`;
  const btnSecondary = `${btnClass} bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={step === "running" ? undefined : onClose}>
      <div
        className="bg-[var(--color-surface)] rounded-lg shadow-xl w-[480px] max-w-[90vw] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-[var(--color-text-heading)]">Import PDF (AI)</h2>
          {step !== "running" && (
            <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-lg leading-none">
              &times;
            </button>
          )}
        </div>

        <div className="px-5 py-4 text-xs text-[var(--color-text)]">
          {step === "warn" && (
            <>
              <p className="mb-2 font-medium">Before you continue:</p>
              <ul className="list-disc pl-4 space-y-1.5 mb-3 text-[var(--color-text-muted)]">
                <li>
                  This feature uses AI (Claude) to read the PDF and recreate it as a Maestro Connect
                  schematic — one schematic page per PDF page.
                </li>
                <li>
                  AI can make mistakes. Review the recreated drawing carefully — devices, ports,
                  wiring, and signal types may be misread or missing.
                </li>
                <li>
                  The document is sent to Anthropic for processing, so <strong>your data may become
                  visible to others</strong>. Don't import documents you're not comfortable sharing.
                </li>
                <li>
                  Devices that aren't recognized in the device library are created automatically as
                  custom devices and used in the drawing.
                </li>
              </ul>
              {!anthropicApiKey && (
                <div className="mb-3">
                  <label className="block mb-1 text-[var(--color-text-muted)]">
                    Anthropic API key (stored only in this browser; also editable in Preferences → AI):
                  </label>
                  <input
                    type="password"
                    value={anthropicApiKey}
                    onChange={(e) => setAnthropicApiKey(e.target.value)}
                    placeholder="sk-ant-..."
                    autoComplete="off"
                    className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-2 py-1 text-xs outline-none"
                  />
                </div>
              )}
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={onClose} className={btnSecondary}>Cancel</button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!anthropicApiKey.trim()}
                  title={anthropicApiKey.trim() ? undefined : "Enter your Anthropic API key first"}
                  className={btnPrimary}
                >
                  I understand — choose PDF…
                </button>
              </div>
            </>
          )}

          {step === "running" && (
            <div className="flex flex-col items-center py-6 gap-3">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-[var(--color-text-muted)] text-center">{status}</p>
              <p className="text-[10px] text-[var(--color-text-muted)] text-center">
                Large drawing packages can take several minutes.
              </p>
            </div>
          )}

          {step === "done" && result && (
            <>
              <p className="mb-2 font-medium text-green-600">Import complete.</p>
              <ul className="list-disc pl-4 space-y-1 text-[var(--color-text-muted)] mb-3">
                <li>{result.pages.length} schematic page{result.pages.length === 1 ? "" : "s"} created</li>
                <li>{result.totalConnections} connection{result.totalConnections === 1 ? "" : "s"} drawn</li>
                <li>{result.matchedDevices} device{result.matchedDevices === 1 ? "" : "s"} matched to the library</li>
                <li>
                  {result.createdDevices} new custom device{result.createdDevices === 1 ? "" : "s"} created
                  {result.createdDevices > 0 ? " (see the Devices pane under Custom)" : ""}
                </li>
              </ul>
              <p className="text-[10px] text-[var(--color-text-muted)] mb-3">
                Review the result carefully — AI recreation can contain mistakes.
              </p>
              <div className="flex justify-end">
                <button onClick={onClose} className={btnPrimary}>Close</button>
              </div>
            </>
          )}

          {step === "error" && (
            <>
              <p className="mb-2 font-medium text-red-600">Import failed</p>
              <p className="text-[var(--color-text-muted)] mb-3 break-words">{error}</p>
              <div className="flex justify-end gap-2">
                <button onClick={onClose} className={btnSecondary}>Close</button>
                <button onClick={() => setStep("warn")} className={btnPrimary}>Try again</button>
              </div>
            </>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={handleFile}
        />
      </div>
    </div>
  );
}
