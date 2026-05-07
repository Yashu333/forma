"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export default function SignupPage() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [done, setDone]         = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const supabase = createClient();

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    if (error) { setError(error.message); setLoading(false); }
    else setDone(true);
  }

  if (done) {
    return (
      <div className="text-center space-y-4 animate-in-up">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-violet-500/15 border border-violet-500/20 text-2xl">
          ✉️
        </div>
        <h2 className="text-xl font-semibold text-[#F0F2FF]">Check your inbox</h2>
        <p className="text-sm text-[#5C6180] max-w-xs mx-auto leading-relaxed">
          We sent a confirmation link to{" "}
          <span className="text-violet-400 font-medium">{email}</span>
        </p>
        <Link
          href="/login"
          className="inline-block text-sm text-[#A8ADCB] hover:text-[#F0F2FF] transition-colors mt-2"
        >
          ← Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-4"
             style={{ background: "linear-gradient(135deg, rgba(249,115,22,0.18) 0%, rgba(251,146,60,0.10) 100%)", border: "1px solid rgba(249,115,22,0.25)" }}>
          <svg width="22" height="22" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="1" width="6" height="6" rx="1.5" fill="#F97316" opacity="1"/>
            <rect x="9" y="1" width="6" height="6" rx="1.5" fill="#FB923C" opacity="0.6"/>
            <rect x="1" y="9" width="6" height="6" rx="1.5" fill="#FB923C" opacity="0.6"/>
            <rect x="9" y="9" width="6" height="6" rx="1.5" fill="#FBBF24" opacity="0.35"/>
          </svg>
        </div>
        <h1 className="text-2xl font-bold brand-text tracking-tight">Forma</h1>
        <p className="text-[#5C6180] text-sm mt-1">Create your workspace</p>
      </div>

      <div className="bg-[#1C1E28] border border-[#2A2D3A] rounded-2xl p-6 shadow-[0_24px_64px_rgba(0,0,0,0.5)]">
        <form onSubmit={handleSignup} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-[#5C6180] font-medium pl-0.5">Email</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="forma-input"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-[#5C6180] font-medium pl-0.5">Password</label>
            <input
              type="password"
              placeholder="Min. 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="forma-input"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 animate-in-up">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full mt-1">
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Creating account…
              </span>
            ) : "Create account"}
          </button>
        </form>
      </div>

      <p className="text-center text-sm text-[#5C6180] mt-5">
        Already have an account?{" "}
        <Link href="/login" className="text-violet-400 hover:text-violet-300 font-medium transition-colors">
          Sign in
        </Link>
      </p>
    </>
  );
}
