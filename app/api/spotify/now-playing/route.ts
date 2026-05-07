import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

async function refreshAccessToken(userId: string, refreshToken: string) {
  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });

  if (!res.ok) return null;

  const { access_token, expires_in } = await res.json();
  const expiresAt = new Date(Date.now() + expires_in * 1000);

  await db.userSettings.update({
    where: { userId },
    data: { spotifyAccessToken: access_token, spotifyTokenExpiresAt: expiresAt },
  });

  return access_token as string;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await db.userSettings.findUnique({ where: { userId: user.id } });
  if (!settings?.spotifyAccessToken || !settings.spotifyRefreshToken) {
    return NextResponse.json({ connected: false });
  }

  let token = settings.spotifyAccessToken;

  // Refresh if expired (with 60s buffer)
  if (!settings.spotifyTokenExpiresAt || settings.spotifyTokenExpiresAt.getTime() - Date.now() < 60_000) {
    const fresh = await refreshAccessToken(user.id, settings.spotifyRefreshToken);
    if (!fresh) return NextResponse.json({ connected: false });
    token = fresh;
  }

  const spotifyRes = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (spotifyRes.status === 204 || spotifyRes.status === 404) {
    return NextResponse.json({ connected: true, playing: false });
  }

  if (!spotifyRes.ok) {
    return NextResponse.json({ connected: true, playing: false });
  }

  const data = await spotifyRes.json();

  if (!data?.item) {
    return NextResponse.json({ connected: true, playing: false });
  }

  return NextResponse.json({
    connected: true,
    playing: data.is_playing,
    track: {
      name: data.item.name,
      artists: (data.item.artists as { name: string }[]).map((a) => a.name).join(", "),
      albumArt: (data.item.album?.images as { url: string }[])?.[1]?.url ?? data.item.album?.images?.[0]?.url ?? null,
      url: data.item.external_urls?.spotify ?? null,
      progressMs: data.progress_ms ?? 0,
      durationMs: data.item.duration_ms ?? 0,
    },
  });
}

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await db.userSettings.update({
    where: { userId: user.id },
    data: { spotifyAccessToken: null, spotifyRefreshToken: null, spotifyTokenExpiresAt: null },
  });

  return NextResponse.json({ ok: true });
}
