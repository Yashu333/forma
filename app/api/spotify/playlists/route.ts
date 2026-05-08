import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

async function getToken(userId: string): Promise<string | null> {
  const settings = await db.userSettings.findUnique({ where: { userId } });
  if (!settings?.spotifyAccessToken || !settings.spotifyRefreshToken) return null;

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
    if (!res.ok) return null;
    const { access_token, expires_in } = await res.json();
    await db.userSettings.update({
      where: { userId },
      data: { spotifyAccessToken: access_token, spotifyTokenExpiresAt: new Date(Date.now() + expires_in * 1000) },
    });
    return access_token as string;
  }

  return settings.spotifyAccessToken;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = await getToken(user.id);
  if (!token) return NextResponse.json({ error: "Not connected" }, { status: 401 });

  const res = await fetch("https://api.spotify.com/v1/me/playlists?limit=50", {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return NextResponse.json({ playlists: [] });
  const data = await res.json() as {
    items: { id: string; name: string; uri: string; images: { url: string }[] }[];
  };

  return NextResponse.json({
    playlists: data.items.map(p => ({
      id: p.id,
      name: p.name,
      uri: p.uri,
      image: p.images?.[0]?.url ?? null,
    })),
  });
}
