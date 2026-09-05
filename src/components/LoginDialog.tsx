import { useState, useEffect } from "react";
import { requestLogin, fetchAuthProviders, type AuthProviders } from "../templateApi";
import { API_URL, CLOUD_ENABLED } from "../selfHosted";

function oauthStart(provider: "microsoft") {
  const returnTo = encodeURIComponent(window.location.href);
  window.location.href = `${API_URL}/auth/${provider}/start?returnTo=${returnTo}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function LoginDialog({ open, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [sentEmail, setSentEmail] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  // Which sign-in methods the API actually has configured (#auth-providers).
  // Until the fetch resolves we render nothing provider-specific.
  const [providers, setProviders] = useState<AuthProviders | null>(null);

  useEffect(() => {
    if (!open || !CLOUD_ENABLED || providers) return;
    fetchAuthProviders().then(setProviders).catch(() => {});
  }, [open, providers]);

  // Defensive: no accounts in a self-hosted build — the Microsoft button below is a
  // page navigation that no fetch-level guard could intercept.
  if (!CLOUD_ENABLED || !open) return null;

  const handleSend = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setError("Enter a valid email address");
      return;
    }
    setSending(true);
    setError("");
    try {
      await requestLogin(trimmed, window.location.href);
      setSentEmail(trimmed);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send login link");
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    setEmail("");
    setSent(false);
    setSentEmail("");
    setError("");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={handleClose}
    >
      <div
        className="rounded-lg shadow-xl w-[380px] max-w-[90vw]"
        style={{
          backgroundColor: "var(--color-surface)",
          color: "var(--color-text)",
          border: "1px solid var(--color-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-heading)" }}>
            Log in to submit
          </h2>
        </div>
        <div className="px-5 py-4">
          {sent ? (
            <div className="text-center py-2">
              <p className="text-sm mb-1" style={{ color: "var(--color-text-heading)" }}>
                Check your email
              </p>
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                We sent a login link to <strong>{sentEmail}</strong>. Click it to log in, then come back here.
              </p>
              <p className="text-xs mt-2" style={{ color: "var(--color-text-muted)", opacity: 0.8 }}>
                Don't see it? Check your spam folder. Some corporate email systems may block it{providers?.microsoft && (
                  <>
                    {" "}— <button
                      type="button"
                      onClick={() => oauthStart("microsoft")}
                      className="underline cursor-pointer"
                      style={{ color: "var(--color-text-muted)" }}
                    >try Microsoft sign-in instead</button>
                  </>
                )}.
              </p>
            </div>
          ) : (
            <>
              {providers?.microsoft && (
                <button
                  type="button"
                  onClick={() => oauthStart("microsoft")}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs rounded transition-colors cursor-pointer"
                  style={{
                    backgroundColor: "var(--color-bg)",
                    color: "var(--color-text)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                    <rect x="1" y="1" width="10.4" height="10.4" fill="#F25022" />
                    <rect x="12.6" y="1" width="10.4" height="10.4" fill="#7FBA00" />
                    <rect x="1" y="12.6" width="10.4" height="10.4" fill="#00A4EF" />
                    <rect x="12.6" y="12.6" width="10.4" height="10.4" fill="#FFB900" />
                  </svg>
                  Sign in with Microsoft
                </button>
              )}
              {providers?.magicLink && providers.microsoft && (
                <div className="flex items-center gap-3 my-3">
                  <div className="flex-1 h-px" style={{ backgroundColor: "var(--color-border)" }} />
                  <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>or</span>
                  <div className="flex-1 h-px" style={{ backgroundColor: "var(--color-border)" }} />
                </div>
              )}
              {(providers?.magicLink ?? true) && <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="you@example.com"
                className="w-full px-3 py-2 text-xs rounded"
                style={{
                  backgroundColor: "var(--color-bg)",
                  color: "var(--color-text)",
                  border: "1px solid var(--color-border)",
                }}
                autoFocus
              />}
              {error && (
                <p className="text-xs mt-2 text-red-500">{error}</p>
              )}
            </>
          )}
        </div>
        <div
          className="px-5 py-3 flex justify-end gap-2 border-t"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={handleClose}
            className="px-3 py-1.5 text-xs rounded transition-colors cursor-pointer"
            style={{
              backgroundColor: "var(--color-surface)",
              color: "var(--color-text)",
              border: "1px solid var(--color-border)",
            }}
          >
            {sent ? "Close" : "Cancel"}
          </button>
          {!sent && (providers?.magicLink ?? true) && (
            <button
              onClick={handleSend}
              disabled={sending}
              className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors cursor-pointer disabled:opacity-50"
            >
              {sending ? "Sending..." : "Send login link"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
