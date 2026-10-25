import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { isDateKey } from "@/lib/frog/dates";
import { hasNul } from "@/lib/frog/validate";

export const dynamic = "force-dynamic";

const MAX_BODY = 20_000;
const noteSelect = { date: true, body: true, mood: true, confidence: true } as const;

// GET ?date=YYYY-MM-DD: that day's rough sheet (or null) and the most recent
// earlier sheet with something written on it, for "Yesterday's sheet".
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const date = new URL(req.url).searchParams.get("date");
  if (!isDateKey(date)) return NextResponse.json({ error: "date must be a YYYY-MM-DD date" }, { status: 400 });

  const [note, previous] = await Promise.all([
    db.dailyNote.findUnique({ where: { userId_date: { userId: user.id, date } }, select: noteSelect }),
    db.dailyNote.findFirst({
      where: { userId: user.id, date: { lt: date }, NOT: { body: "" } },
      orderBy: { date: "desc" },
      select: { date: true, body: true },
    }),
  ]);
  return NextResponse.json({ note, previous });
}

// PUT { date, body?, mood?, confidence? }: saves the fields sent (null clears a check-in).
export async function PUT(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let input;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }
  const { date, body, mood, confidence } = input;
  if (!isDateKey(date)) return NextResponse.json({ error: "date must be a YYYY-MM-DD date" }, { status: 400 });
  if (body !== undefined && (typeof body !== "string" || body.length > MAX_BODY || hasNul(body))) {
    return NextResponse.json({ error: `body must be text of at most ${MAX_BODY} characters` }, { status: 400 });
  }
  const scale = (v: unknown, max: number) => v === undefined || v === null || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= max);
  if (!scale(mood, 4)) return NextResponse.json({ error: "mood must be 1 to 4 or null" }, { status: 400 });
  if (!scale(confidence, 3)) return NextResponse.json({ error: "confidence must be 1 to 3 or null" }, { status: 400 });

  const data = {
    ...(body !== undefined && { body }),
    ...(mood !== undefined && { mood }),
    ...(confidence !== undefined && { confidence }),
  };
  const note = await db.dailyNote.upsert({
    where: { userId_date: { userId: user.id, date } },
    create: { userId: user.id, date, ...data },
    update: data,
    select: noteSelect,
  });
  return NextResponse.json(note);
}
