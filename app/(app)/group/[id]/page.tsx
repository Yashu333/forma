import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { redirect, notFound } from "next/navigation";
import KanbanBoard from "@/components/board/KanbanBoard";

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const group = await db.group.findFirst({
    where: { id, ownerId: user.id },
    include: {
      statuses: { orderBy: { order: "asc" } },
    },
  });
  if (!group) notFound();

  const tasks = await db.task.findMany({
    where: { groupId: id, parentTaskId: null, deletedAt: null, archivedAt: null },
    orderBy: { order: "asc" },
    include: { _count: { select: { subtasks: { where: { deletedAt: null, archivedAt: null } }, comments: true } } },
  });

  return (
    <KanbanBoard
      key={group.id}
      group={JSON.parse(JSON.stringify(group))}
      initialTasks={JSON.parse(JSON.stringify(tasks))}
      userId={user.id}
    />
  );
}
