import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LayoutGrid, ArrowRight } from "lucide-react";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const groups: { id: string; name: string; color: string; _count: { tasks: number } }[] =
    await db.group.findMany({
      where: { ownerId: user.id },
      orderBy: { order: "asc" },
      include: { _count: { select: { tasks: true } } },
    });

  const firstName = user.email?.split("@")[0] ?? "there";

  return (
    <div className="p-7 max-w-5xl">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#EDE0D0] tracking-tight">
          Good morning, <span className="gradient-text">{firstName}</span>
        </h1>
        <p className="text-sm text-[#7A6A5A] mt-1">
          {groups.length === 0
            ? "Create your first project to get started"
            : `${groups.length} project${groups.length !== 1 ? "s" : ""} · ${groups.reduce((acc, g) => acc + g._count.tasks, 0)} total tasks`}
        </p>
      </div>

      {groups.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#1A1714] border border-[#2C2820] flex items-center justify-center mb-5">
            <LayoutGrid className="w-6 h-6 text-[#3C3828]" />
          </div>
          <h2 className="text-base font-semibold text-[#B8A898] mb-2">No projects yet</h2>
          <p className="text-sm text-[#7A6A5A] max-w-xs leading-relaxed">
            Create a project from the sidebar to organize your work into boards.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {groups.map((group) => (
            <Link key={group.id} href={`/group/${group.id}`} className="group block">
              <div className="relative bg-[#1A1714] border border-[#2C2820] rounded-2xl p-5 overflow-hidden hover:border-[#3C3828] hover:bg-[#1E1B17] hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] transition-all duration-200">
                {/* Color accent bar */}
                <div
                  className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl opacity-70"
                  style={{ background: group.color }}
                />

                <div className="flex items-start justify-between mb-4">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold text-white"
                    style={{
                      background: `${group.color}22`,
                      border: `1px solid ${group.color}33`,
                      color: group.color,
                    }}
                  >
                    {group.name.slice(0, 2).toUpperCase()}
                  </div>
                  <ArrowRight className="w-4 h-4 text-[#3C3828] group-hover:text-[#7A6A5A] group-hover:translate-x-0.5 transition-all duration-150" />
                </div>

                <h2 className="font-semibold text-[#EDE0D0] text-sm mb-1 group-hover:text-white transition-colors">
                  {group.name}
                </h2>
                <p className="text-xs text-[#7A6A5A]">
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
