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

// GET /api/spotify/controls — list available devices
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = await getToken(user.id);
  if (!token) return NextResponse.json({ error: "Not connected" }, { status: 401 });

  const res = await fetch("https://api.spotify.com/v1/me/player/devices", {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return NextResponse.json({ devices: [] });
  const data = await res.json();
  return NextResponse.json({
    devices: (data.devices as { id: string; name: string; type: string; is_active: boolean }[]).map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      active: d.is_active,
    })),
  });
}

// POST /api/spotify/controls — send a playback command
// body: { action: "play" | "pause" | "next" | "previous" | "transfer", deviceId?: string }
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = await getToken(user.id);
  if (!token) return NextResponse.json({ error: "Not connected" }, { status: 401 });

  const { action, deviceId } = await req.json() as { action: string; deviceId?: string };

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  let spotifyRes: Response;

  if (action === "play") {
    const url = deviceId
      ? `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`
      : "https://api.spotify.com/v1/me/player/play";
    spotifyRes = await fetch(url, { method: "PUT", headers, body: "{}" });
  } else if (action === "pause") {
    const url = deviceId
      ? `https://api.spotify.com/v1/me/player/pause?device_id=${deviceId}`
      : "https://api.spotify.com/v1/me/player/pause";
    spotifyRes = await fetch(url, { method: "PUT", headers });
  } else if (action === "next") {
    spotifyRes = await fetch("https://api.spotify.com/v1/me/player/next", { method: "POST", headers });
  } else if (action === "previous") {
    spotifyRes = await fetch("https://api.spotify.com/v1/me/player/previous", { method: "POST", headers });
  } else if (action === "transfer" && deviceId) {
    spotifyRes = await fetch("https://api.spotify.com/v1/me/player", {
      method: "PUT",
      headers,
      body: JSON.stringify({ device_ids: [deviceId], play: true }),
    });
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  if (!spotifyRes.ok && spotifyRes.status !== 204) {
    const text = await spotifyRes.text().catch(() => "");
    return NextResponse.json({ error: text || "Spotify error" }, { status: spotifyRes.status });
  }

  return NextResponse.json({ ok: true });
}
