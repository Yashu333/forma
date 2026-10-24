import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { compareTasks } from "@/lib/frog/abcde";
import { visibleTopLevelTask } from "@/lib/frog/today.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Everything the user could plan: open work only (a task in a celebrate
  // column is done), whatever day it is currently planned for.
  const tasks = await db.task.findMany({
    where: { ...visibleTopLevelTask(user.id), status: { celebrate: false } },
    select: {
      id: true,
      title: true,
      groupId: true,
      statusId: true,
      priority: true,
      order: true,
      abcde: true,
      abcdeRank: true,
      plannedFor: true,
      dueDate: true,
      group: { select: { id: true, name: true, color: true, order: true } },
    },
    orderBy: [{ order: "asc" }, { id: "asc" }],
  });

  type Row = (typeof tasks)[number];
  // Project order first (id keeps two projects with equal order from interleaving).
  tasks.sort((a: Row, b: Row) =>
    a.group.order - b.group.order || a.group.id.localeCompare(b.group.id) || compareTasks(a, b));
  // `group.order` was only needed for sorting.
  return NextResponse.json(tasks.map((t: Row) => ({ ...t, group: { id: t.group.id, name: t.group.name, color: t.group.color } })));
}
