import { useState, useRef, useEffect } from "react";
import { checkSession, claimAuthToken, logout } from "../templateApi";
import LoginDialog from "./LoginDialog";

interface User {
  id: string;
  email: string;
  name: string | null;
}

export default function UserMenuButton() {
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const init = async () => {
      // Check for auth handoff token from magic link / OAuth redirect
      const params = new URLSearchParams(window.location.search);
      const auth = params.get("auth");
      if (auth) {
        params.delete("auth");
        const qs = params.toString();
        const clean = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
        history.replaceState(null, "", clean);
        try {
          const u = await claimAuthToken(auth);
          setUser(u);
          setLoaded(true);
          return;
        } catch {
          // Token invalid/expired — fall through to session check
        }
      }
      const u = await checkSession();
      setUser(u);
      setLoaded(true);
    };
    init();
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setDropdownOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [dropdownOpen]);

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setDropdownOpen(false);
  };

  if (!loaded) return null;

  if (!user) {
    return (
      <>
        <button
          onClick={() => setShowLogin(true)}
          className="px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-heading)] rounded transition-colors cursor-pointer"
        >
          Log in
        </button>
        <LoginDialog open={showLogin} onClose={() => setShowLogin(false)} />
      </>
    );
  }

  const displayName = user.name || user.email;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-heading)] rounded transition-colors cursor-pointer flex items-center gap-1"
      >
        {displayName}
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {dropdownOpen && (
        <div
          className="absolute right-0 mt-1 w-48 rounded-lg shadow-lg py-1 z-50"
          style={{
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          <div className="px-3 py-2 border-b" style={{ borderColor: "var(--color-border)" }}>
            <p className="text-xs truncate" style={{ color: "var(--color-text-muted)" }}>{user.email}</p>
          </div>
          <a
            href="https://devices.easyschematic.live"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setDropdownOpen(false)}
            className="block px-3 py-2 text-xs hover:bg-[var(--color-surface-hover)] transition-colors"
            style={{ color: "var(--color-text)" }}
          >
            Device Library ↗
          </a>
          <button
            onClick={handleLogout}
            className="w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
