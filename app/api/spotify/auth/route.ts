import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI!;

  const scope = "user-read-currently-playing user-read-playback-state user-modify-playback-state user-read-playback-position playlist-read-private playlist-read-collaborative";
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope,
    redirect_uri: redirectUri,
  });

  return NextResponse.redirect(`https://accounts.spotify.com/authorize?${params}`);
}
