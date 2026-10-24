"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Loader2 } from "lucide-react";
import BrandMark from "@/components/ui/BrandMark";

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

  return (
    <>
      <div className="mb-8 flex flex-col items-center text-center">
        <BrandMark size={40} />
        <h1 className="mt-4 text-[28px] font-semibold tracking-[-0.025em] leading-[1.1] text-foreground">Sign in to Forma</h1>
        <p className="text-sm mt-2 text-muted-foreground">Pick up where you left off.</p>
      </div>

      <div className="rounded-lg border border-border bg-surface p-6">
        <button onClick={handleGoogle} type="button"
          className="flex items-center justify-center gap-2 h-10 rounded-md text-sm w-full border border-border text-foreground transition-colors hover:bg-raised hover:border-border-strong">
          <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#EA4335" d="M5.266 9.765A7.077 7.077 0 0112 4.909c1.69 0 3.218.6 4.418 1.582L19.91 3C17.782 1.145 15.055 0 12 0 7.27 0 3.198 2.698 1.24 6.65l4.026 3.115z"/>
            <path fill="#34A853" d="M16.04 18.013C14.951 18.716 13.566 19.09 12 19.09c-3.133 0-5.78-2.013-6.723-4.822L1.237 17.335C3.193 21.294 7.265 24 12 24c2.933 0 5.735-1.043 7.834-3L16.04 18.013z"/>
            <path fill="#4A90E2" d="M19.834 21C22.029 18.952 23.455 15.904 23.455 12c0-.709-.091-1.473-.182-2.182H12v4.637h6.436c-.273 1.557-1.124 2.764-2.395 3.558L19.834 21z"/>
            <path fill="#FBBC05" d="M5.277 14.268A7.12 7.12 0 014.909 12c0-.782.125-1.533.357-2.235L1.24 6.65A11.934 11.934 0 000 12c0 1.92.445 3.73 1.237 5.335l4.04-3.067z"/>
          </svg>
          Continue with Google
        </button>

        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-subtle">or use email</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <form onSubmit={handleEmail} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-xs font-medium text-muted-foreground">Email</label>
            <input id="email" type="email" autoComplete="email" placeholder="you@example.com" value={email}
              onChange={e => setEmail(e.target.value)} required className="forma-input" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-xs font-medium text-muted-foreground">Password</label>
            <input id="password" type="password" autoComplete="current-password" placeholder="Your password" value={password}
              onChange={e => setPassword(e.target.value)} required className="forma-input" />
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
                Signing in…
              </span>
            ) : "Sign in"}
          </button>
        </form>
      </div>

      <p className="text-center text-sm mt-5 text-muted-foreground">
        No account?{" "}
        <Link href="/signup" className="font-medium text-foreground underline underline-offset-4 decoration-border-strong hover:decoration-foreground rounded-sm">
          Create one
        </Link>
      </p>
    </>
  );
}
