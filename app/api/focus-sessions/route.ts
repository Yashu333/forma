import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { hasNul } from "@/lib/frog/validate";

const MIN_SEC = 60;
const MAX_SEC = 4 * 60 * 60;

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

// Logs one finished (or skipped) focus session from the Pomodoro timer.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Body must be a JSON object");

  const { taskId, startedAt, endedAt, durationSec, completed } = body;
  const started = typeof startedAt === "string" ? new Date(startedAt) : new Date(NaN);
  const ended = typeof endedAt === "string" ? new Date(endedAt) : new Date(NaN);
  if (Number.isNaN(started.getTime()) || Number.isNaN(ended.getTime())) return bad("startedAt and endedAt must be ISO date-times");
  if (ended <= started) return bad("endedAt must be after startedAt");
  if (!Number.isInteger(durationSec) || durationSec < MIN_SEC || durationSec > MAX_SEC) {
    return bad(`durationSec must be a whole number from ${MIN_SEC} to ${MAX_SEC}`);
  }
  // Pauses make a session's wall-clock span longer than its focus time, never shorter.
  if (durationSec > (ended.getTime() - started.getTime()) / 1000 + 5) return bad("durationSec is longer than the time between startedAt and endedAt");
  if (typeof completed !== "boolean") return bad("completed must be a boolean");

  let linkedTaskId: string | null = null;
  if (taskId !== undefined && taskId !== null) {
    if (typeof taskId !== "string" || !taskId || hasNul(taskId)) return bad("taskId must be a task id or null");
    const task = await db.task.findFirst({ where: { id: taskId, deletedAt: null, group: { ownerId: user.id } }, select: { id: true } });
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    linkedTaskId = task.id;
  }

  const session = await db.focusSession.create({
    data: { userId: user.id, taskId: linkedTaskId, startedAt: started, endedAt: ended, durationSec, completed },
  });
  return NextResponse.json(session, { status: 201 });
}
