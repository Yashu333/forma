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

  const res = await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=50", {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return NextResponse.json({ playlists: [] });

  const data = await res.json() as {
    items: {
      context: { type: string; uri: string; external_urls: { spotify: string } } | null;
      track: { album: { images: { url: string }[] } };
    }[];
  };

  const seen = new Set<string>();
  const playlists: { id: string; name: string; uri: string; image: string | null }[] = [];

  // Collect unique playlist URIs first, then fetch names in parallel
  const uniqueContexts = data.items
    .filter(item => item.context?.type === "playlist" && !seen.has(item.context.uri) && seen.add(item.context.uri))
    .map(item => item.context!);

  await Promise.all(uniqueContexts.map(async ctx => {
    const id = ctx.uri.split(":").pop()!;
    const pRes = await fetch(`https://api.spotify.com/v1/playlists/${id}?fields=id,name,uri,images`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!pRes.ok) return;
    const p = await pRes.json() as { id: string; name: string; uri: string; images: { url: string }[] };
    playlists.push({
      id: p.id,
      name: p.name,
      uri: p.uri,
      image: p.images?.[0]?.url ?? null,
    });
  }));

  // Re-sort to preserve recency order (Promise.all doesn't guarantee order)
  const order = uniqueContexts.map(c => c.uri);
  playlists.sort((a, b) => order.indexOf(a.uri) - order.indexOf(b.uri));

  return NextResponse.json({ playlists });
}
