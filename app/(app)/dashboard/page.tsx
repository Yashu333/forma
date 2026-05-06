import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LayoutGrid, Plus } from "lucide-react";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const groups: { id: string; name: string; color: string; _count: { tasks: number } }[] = await db.group.findMany({
    where: { ownerId: user.id },
    orderBy: { order: "asc" },
    include: { _count: { select: { tasks: true } } },
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-0.5">All your projects</p>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <LayoutGrid className="w-12 h-12 text-muted-foreground mb-4 opacity-40" />
          <p className="text-muted-foreground mb-2">No projects yet</p>
          <p className="text-sm text-muted-foreground/60">Create a project from the sidebar to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((group) => (
            <Link key={group.id} href={`/group/${group.id}`}>
              <div className="bg-card border border-border rounded-xl p-5 card-hover cursor-pointer">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-3 h-3 rounded-full" style={{ background: group.color }} />
                  <h2 className="font-semibold text-foreground">{group.name}</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  {group._count.tasks} {group._count.tasks === 1 ? "task" : "tasks"}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
