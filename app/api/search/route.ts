import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { hasNul } from "@/lib/frog/validate";

const MAX_RESULTS = 20;

// Global task search for the command palette: the user's own tasks and
// subtasks whose title or description contains the query.
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length > 200) return NextResponse.json({ error: "q must be 200 characters or fewer" }, { status: 400 });
  if (hasNul(q)) return NextResponse.json({ error: "q must not contain NUL characters" }, { status: 400 });
  if (q.length < 2) return NextResponse.json([]);

  // Prisma hands "contains" to LIKE unescaped, so "_" and "%" in the query would
  // act as wildcards. Escape them (and the escape character) to match literally.
  const needle = q.replace(/[\\%_]/g, "\\$&");

  const rows = await db.task.findMany({
    where: {
      deletedAt: null,
      archivedAt: null,
      group: { ownerId: user.id },
      OR: [
        { title: { contains: needle, mode: "insensitive" } },
        { description: { contains: needle, mode: "insensitive" } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 80,
    select: {
      id: true,
      title: true,
      parentTaskId: true,
      dueDate: true,
      priority: true,
      abcde: true,
      abcdeRank: true,
      completedAt: true,
      group: { select: { id: true, name: true, color: true } },
      status: { select: { celebrate: true } },
      parent: { select: { id: true, title: true, deletedAt: true, archivedAt: true } },
    },
  });

  type Row = (typeof rows)[number];
  const results = rows
    .filter((r: Row) => !r.parent || (!r.parent.deletedAt && !r.parent.archivedAt))
    .map((r: Row) => ({
      id: r.id,
      title: r.title,
      parentTaskId: r.parentTaskId,
      parentTitle: r.parent?.title ?? null,
      done: r.status.celebrate,
      dueDate: r.dueDate,
      priority: r.priority,
      abcde: r.abcde,
      abcdeRank: r.abcdeRank,
      group: r.group,
    }));
  // Open tasks first; the sort is stable, so recent updates stay first within each.
  results.sort((a: { done: boolean }, b: { done: boolean }) => Number(a.done) - Number(b.done));
  return NextResponse.json(results.slice(0, MAX_RESULTS));
}
