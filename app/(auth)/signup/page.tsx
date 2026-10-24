"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Loader2, MailCheck } from "lucide-react";
import BrandMark from "@/components/ui/BrandMark";

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
      <div className="flex flex-col items-center text-center animate-in-up" role="status">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg border border-border bg-surface text-foreground">
          <MailCheck className="w-5 h-5" aria-hidden="true" />
        </div>
        <h2 className="mt-4 text-xl font-semibold tracking-[-0.02em] text-foreground">Check your inbox</h2>
        <p className="mt-2 text-sm text-muted-foreground max-w-xs leading-relaxed">
          We sent a confirmation link to{" "}
          <span className="text-foreground font-medium break-all">{email}</span>
        </p>
        <Link
          href="/login"
          className="mt-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-sm"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="mb-8 flex flex-col items-center text-center">
        <BrandMark size={40} />
        <h1 className="mt-4 text-[28px] font-semibold tracking-[-0.025em] leading-[1.1] text-foreground">Create your workspace</h1>
        <p className="text-sm mt-2 text-muted-foreground">Boards and a daily plan, in one place.</p>
      </div>

      <div className="rounded-lg border border-border bg-surface p-6">
        <form onSubmit={handleSignup} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-xs font-medium text-muted-foreground">Email</label>
            <input id="email" type="email" autoComplete="email" placeholder="you@example.com" value={email}
              onChange={(e) => setEmail(e.target.value)} required className="forma-input" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-xs font-medium text-muted-foreground">Password</label>
            <input id="password" type="password" autoComplete="new-password" placeholder="At least 6 characters" value={password}
              onChange={(e) => setPassword(e.target.value)} required minLength={6} className="forma-input" />
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 px-3 py-2 rounded-md border border-border bg-surface animate-in-up">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px text-danger" aria-hidden="true" />
              <p className="text-xs text-foreground">{error}</p>
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full h-10">
            {loading ? (
              <span role="status" className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Creating account…
              </span>
            ) : "Create account"}
          </button>
        </form>
      </div>

      <p className="text-center text-sm text-muted-foreground mt-5">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4 decoration-border-strong hover:decoration-foreground rounded-sm">
          Sign in
        </Link>
      </p>
    </>
  );
}
