"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const router   = useRouter();
  const supabase = createClient();

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); setLoading(false); }
    else router.push("/dashboard");
  }

  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/auth/callback` } });
  }

  async function handleGithub() {
    await supabase.auth.signInWithOAuth({ provider: "github", options: { redirectTo: `${location.origin}/auth/callback` } });
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "0.625rem 0.875rem", borderRadius: "0.75rem",
    fontSize: "0.875rem", background: "var(--elevated)", color: "var(--text-primary)",
    border: "1px solid var(--border-strong)", outline: "none", transition: "border-color 0.15s",
  };

  return (
    <>
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-4"
             style={{ background: "linear-gradient(135deg,rgba(249,115,22,0.22),rgba(251,146,60,0.12))", border: "1px solid rgba(249,115,22,0.30)" }}>
          <svg width="22" height="22" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="1" width="6" height="6" rx="1.5" fill="#F97316"/>
            <rect x="9" y="1" width="6" height="6" rx="1.5" fill="#FB923C" opacity="0.7"/>
            <rect x="1" y="9" width="6" height="6" rx="1.5" fill="#FB923C" opacity="0.7"/>
            <rect x="9" y="9" width="6" height="6" rx="1.5" fill="#FBBF24" opacity="0.4"/>
          </svg>
        </div>
        <h1 className="text-2xl font-black tracking-widest uppercase brand-text">FORMA</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>Sign in to your workspace</p>
      </div>

      {/* Card */}
      <div className="rounded-2xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border-strong)", boxShadow: "0 24px 64px rgba(0,0,0,0.4)" }}>
        {/* OAuth */}
        <div className="grid grid-cols-2 gap-2.5 mb-5">
          {[
            { label: "Google", onClick: handleGoogle, icon: (
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
                <path fill="#EA4335" d="M5.266 9.765A7.077 7.077 0 0112 4.909c1.69 0 3.218.6 4.418 1.582L19.91 3C17.782 1.145 15.055 0 12 0 7.27 0 3.198 2.698 1.24 6.65l4.026 3.115z"/>
                <path fill="#34A853" d="M16.04 18.013C14.951 18.716 13.566 19.09 12 19.09c-3.133 0-5.78-2.013-6.723-4.822L1.237 17.335C3.193 21.294 7.265 24 12 24c2.933 0 5.735-1.043 7.834-3L16.04 18.013z"/>
                <path fill="#4A90E2" d="M19.834 21C22.029 18.952 23.455 15.904 23.455 12c0-.709-.091-1.473-.182-2.182H12v4.637h6.436c-.273 1.557-1.124 2.764-2.395 3.558L19.834 21z"/>
                <path fill="#FBBC05" d="M5.277 14.268A7.12 7.12 0 014.909 12c0-.782.125-1.533.357-2.235L1.24 6.65A11.934 11.934 0 000 12c0 1.92.445 3.73 1.237 5.335l4.04-3.067z"/>
              </svg>
            )},
            { label: "GitHub", onClick: handleGithub, icon: (
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
              </svg>
            )},
          ].map(({ label, onClick, icon }) => (
            <button key={label} onClick={onClick}
              className="flex items-center justify-center gap-2 h-10 rounded-xl text-sm transition-all duration-150"
              style={{ background: "var(--elevated)", border: "1px solid var(--border-strong)", color: "var(--text-secondary)" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-accent)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; }}>
              {icon} {label}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 h-px" style={{ background: "var(--border-strong)" }} />
          <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>or continue with email</span>
          <div className="flex-1 h-px" style={{ background: "var(--border-strong)" }} />
        </div>

        {/* Form */}
        <form onSubmit={handleEmail} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium pl-0.5" style={{ color: "var(--text-muted)" }}>Email</label>
            <input type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required
              style={inputStyle}
              onFocus={e => e.currentTarget.style.borderColor = "var(--border-accent)"}
              onBlur={e => e.currentTarget.style.borderColor = "var(--border-strong)"} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium pl-0.5" style={{ color: "var(--text-muted)" }}>Password</label>
            <input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required
              style={inputStyle}
              onFocus={e => e.currentTarget.style.borderColor = "var(--border-accent)"}
              onBlur={e => e.currentTarget.style.borderColor = "var(--border-strong)"} />
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg animate-in-up"
                 style={{ background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.25)" }}>
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "#F87171" }} />
              <p className="text-xs" style={{ color: "#FCA5A5" }}>{error}</p>
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full mt-1">
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Signing in…
              </span>
            ) : "Sign in"}
          </button>
        </form>
      </div>

      <p className="text-center text-sm mt-5" style={{ color: "var(--text-muted)" }}>
        No account?{" "}
        <Link href="/signup" className="font-medium transition-colors"
              style={{ color: "var(--accent)" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = "0.8"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = "1"}>
          Create one
        </Link>
      </p>
    </>
  );
}
