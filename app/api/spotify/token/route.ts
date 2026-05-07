import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await db.userSettings.findUnique({ where: { userId: user.id } });
  if (!settings?.spotifyAccessToken || !settings.spotifyRefreshToken) {
    return NextResponse.json({ error: "Not connected" }, { status: 401 });
  }

  let token = settings.spotifyAccessToken;

  if (!settings.spotifyTokenExpiresAt || settings.spotifyTokenExpiresAt.getTime() - Date.now() < 60_000) {
    const clientId = process.env.SPOTIFY_CLIENT_ID!;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: settings.spotifyRefreshToken }),
    });
    if (!res.ok) return NextResponse.json({ error: "Token refresh failed" }, { status: 401 });
    const { access_token, expires_in } = await res.json();
    await db.userSettings.update({
      where: { userId: user.id },
      data: { spotifyAccessToken: access_token, spotifyTokenExpiresAt: new Date(Date.now() + expires_in * 1000) },
    });
    token = access_token as string;
  }

  return NextResponse.json({ token });
}
