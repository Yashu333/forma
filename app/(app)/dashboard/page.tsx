import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LayoutGrid, ArrowRight } from "lucide-react";
import Greeting from "@/components/dashboard/Greeting";

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
  const userId = user.id;

  return (
    <div className="p-7 max-w-5xl" style={{ color: "var(--text-primary)" }}>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">
          Hello, <Greeting userId={userId} fallback={firstName} />
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          {groups.length === 0
            ? "Create your first project to get started"
            : `${groups.length} project${groups.length !== 1 ? "s" : ""} · ${groups.reduce((a, g) => a + g._count.tasks, 0)} total tasks`}
        </p>

        <div className="flex items-center gap-0 mt-4 w-fit">
          {[
            { label: "THINK",   color: "#a78bfa" },
            { label: "PLAN",    color: "#60a5fa" },
            { label: "DO",      color: "#34d399" },
            { label: "REFLECT", color: "#ff6b6b" },
          ].map(({ label, color }, i) => (
            <div key={label} className="flex items-center">
              <span
                className="inline-flex items-center justify-center text-[10px] font-black px-3 h-7"
                style={{
                  color,
                  background: `${color}18`,
                  border: `1.5px solid ${color}40`,
                  borderRadius: "4px",
                  letterSpacing: "0.16em",
                }}
              >
                {label}
              </span>
              {i < 3 && (
                <span className="mx-1.5 text-base font-bold" style={{ color }}>
                  →
                </span>
              )}
            </div>
          ))}
          <span className="mx-1.5 text-base font-bold" style={{ color: "#ff6b6b" }}>∞</span>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
               style={{ background: "var(--card)", border: "1px solid var(--border-strong)" }}>
            <LayoutGrid className="w-6 h-6" style={{ color: "var(--text-disabled)" }} />
          </div>
          <h2 className="text-base font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>No projects yet</h2>
          <p className="text-sm max-w-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Create a project from the sidebar to organize your work into boards.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map(group => (
            <Link key={group.id} href={`/group/${group.id}`} className="group block">
              <div className="relative rounded-2xl p-5 overflow-hidden transition-all duration-200 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)]"
                   style={{ background: "var(--card)", border: "1px solid var(--border-strong)", borderLeft: `3px solid ${group.color}` }}>

                <div className="flex items-start justify-between mb-4 pl-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold"
                       style={{ background: `${group.color}20`, border: `1px solid ${group.color}40`, color: group.color }}>
                    {group.name.slice(0, 2).toUpperCase()}
                  </div>
                  <ArrowRight className="w-4 h-4 transition-all duration-150 group-hover:translate-x-0.5"
                              style={{ color: "var(--text-disabled)" }} />
                </div>

                <h2 className="font-semibold text-sm mb-1 transition-colors group-hover:text-white pl-3"
                    style={{ color: "var(--text-primary)" }}>
                  {group.name}
                </h2>
                <p className="text-xs pl-3" style={{ color: "var(--text-muted)" }}>
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
