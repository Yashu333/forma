import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import type { Abcde } from "@/types";
import { hasNul, parseAbcde, parseAbcdeRank } from "@/lib/frog/validate";
import { visibleTopLevelTask } from "@/lib/frog/today.server";

export const dynamic = "force-dynamic";

// The "Label tasks" screen (/today/label): every open task with its ABCDE
// label, quick-add of new tasks, and saving several labels in one go (tapping a
// letter renumbers the rest of that letter).

const MAX_TITLE = 2000;
const MAX_UPDATES = 500;

const taskSelect = {
  id: true,
  title: true,
  abcde: true,
  abcdeRank: true,
  plannedFor: true,
  createdAt: true,
  group: { select: { id: true, name: true, color: true } },
} as const;

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

async function readJsonObject(req: Request): Promise<Record<string, unknown> | NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Body must be a JSON object");
  return body as Record<string, unknown>;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Open work only: a task in a celebrate column is done and needs no label.
  const [tasks, projects] = await Promise.all([
    db.task.findMany({
      where: { ...visibleTopLevelTask(user.id), status: { celebrate: false } },
      select: taskSelect,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    }),
    db.group.findMany({
      where: { ownerId: user.id },
      select: { id: true, name: true, color: true },
      orderBy: [{ order: "asc" }, { id: "asc" }],
    }),
  ]);
  return NextResponse.json({ tasks, projects });
}

/** Adds a task to the first open column of one of the user's projects. Body: `{ title, groupId }`. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await readJsonObject(req);
  if (body instanceof NextResponse) return body;
  const { title, groupId } = body;

  if (typeof title !== "string" || !title.trim()) return bad("title is required");
  if (hasNul(title)) return bad("title must not contain NUL characters");
  const cleanTitle = title.trim();
  if (cleanTitle.length > MAX_TITLE) return bad(`title must be at most ${MAX_TITLE} characters`);
  if (typeof groupId !== "string" || !groupId) return bad("groupId is required");

  const group = hasNul(groupId) ? null : await db.group.findFirst({
    where: { id: groupId, ownerId: user.id },
    select: {
      id: true,
      // The first column that isn't a Done column, the same place the board adds to.
      statuses: { orderBy: [{ celebrate: "asc" }, { order: "asc" }, { id: "asc" }], take: 1, select: { id: true, celebrate: true } },
    },
  });
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const status = group.statuses[0];
  if (!status) return bad("This project has no columns");
  if (status.celebrate) return bad("This project only has Done columns");

  // At the bottom of the column, like a task added on the board.
  const order = await db.task.count({
    where: { statusId: status.id, parentTaskId: null, deletedAt: null, archivedAt: null },
  });
  const task = await db.task.create({
    data: {
      title: cleanTitle,
      groupId: group.id,
      statusId: status.id,
      order,
      createdBy: user.id,
      activity: { create: { userId: user.id, action: "created" } },
    },
    select: taskSelect,
  });
  return NextResponse.json(task, { status: 201 });
}

/**
 * Saves several labels at once. Body: `{ updates: [{ id, abcde, abcdeRank }] }`,
 * each the full wanted label (a rank needs a letter). All or nothing.
 */
export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await readJsonObject(req);
  if (body instanceof NextResponse) return body;
  const { updates } = body;
  if (!Array.isArray(updates) || updates.length === 0) return bad("updates must be a non-empty array");
  if (updates.length > MAX_UPDATES) return bad(`at most ${MAX_UPDATES} updates per request`);

  const parsed: { id: string; abcde: Abcde | null; abcdeRank: number | null }[] = [];
  const seen = new Set<string>();
  for (const u of updates) {
    if (!u || typeof u !== "object" || Array.isArray(u)) return bad("each update must be an object");
    const { id, abcde, abcdeRank } = u as Record<string, unknown>;
    if (typeof id !== "string" || !id) return bad("each update needs a task id");
    if (seen.has(id)) return bad("a task can appear only once in updates");
    seen.add(id);
    const letter = parseAbcde(abcde === undefined ? null : abcde);
    if (!letter.ok) return bad(letter.error);
    const rank = parseAbcdeRank(abcdeRank === undefined ? null : abcdeRank);
    if (!rank.ok) return bad(rank.error);
    if (letter.value === null && rank.value !== null) return bad("abcdeRank requires an abcde letter");
    parsed.push({ id, abcde: letter.value, abcdeRank: rank.value });
  }

  // Every id must be a live top-level task of the caller's; otherwise nothing is written.
  // (An id with a NUL can't exist and would make Postgres throw: a 404.)
  const ids = parsed.map((p) => p.id);
  const existing: { id: string; abcde: Abcde | null }[] = ids.some(hasNul) ? [] : await db.task.findMany({
    where: { id: { in: ids }, ...visibleTopLevelTask(user.id) },
    select: { id: true, abcde: true },
  });
  if (existing.length !== ids.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const before = new Map(existing.map((t) => [t.id, t.abcde]));

  const writes = [];
  for (const p of parsed) {
    writes.push(db.task.update({ where: { id: p.id }, data: { abcde: p.abcde, abcdeRank: p.abcdeRank }, select: { id: true, abcde: true, abcdeRank: true } }));
    const from = before.get(p.id) ?? null;
    if (from !== p.abcde) {
      writes.push(db.activity.create({
        data: { taskId: p.id, userId: user.id, action: "abcde_changed", metadata: { from, to: p.abcde } },
      }));
    }
  }
  const results = await db.$transaction(writes);
  const tasks = results.filter((r: { abcdeRank?: unknown }) => "abcdeRank" in r);
  return NextResponse.json({ tasks });
}
