import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  console.log("[callback] code present:", !!code, "origin:", origin, "next:", next);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    console.log("[callback] exchangeCodeForSession error:", error);
    if (!error) {
      console.log("[callback] success, redirecting to:", `${origin}${next}`);
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  console.log("[callback] failed, redirecting to login");
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
