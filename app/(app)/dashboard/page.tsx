import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LayoutGrid, ArrowRight } from "lucide-react";
import Greeting from "@/components/dashboard/Greeting";
import TodaysFrogCard from "@/components/dashboard/TodaysFrogCard";
import NewProjectButton from "@/components/dashboard/NewProjectButton";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rawGroups = await db.group.findMany({
    where: { ownerId: user.id },
    orderBy: { order: "asc" },
    include: {
      _count: { select: { tasks: true } },
      statuses: {
        where: { celebrate: false },
        select: { _count: { select: { tasks: { where: { parentTaskId: null, deletedAt: null, archivedAt: null } } } } },
      },
    },
  });
  type RawGroup = (typeof rawGroups)[number];
  const groups: (RawGroup & { remainingTasks: number })[] = rawGroups.map((g: RawGroup) => ({
    ...g,
    remainingTasks: g.statuses.reduce((a: number, s: RawGroup["statuses"][number]) => a + s._count.tasks, 0),
  }));

  const firstName = user.email?.split("@")[0] ?? "there";
  const userId = user.id;

  const remaining = groups.reduce((a, g) => a + g.remainingTasks, 0);

  return (
    <div className="overflow-y-auto h-full text-foreground">
    <div className="p-5 sm:p-7 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-[28px] sm:text-4xl font-semibold tracking-[-0.025em] leading-[1.1]">
          Hello, <Greeting userId={userId} fallback={firstName} />
        </h1>
        <p className="text-sm mt-2 text-muted-foreground tabular">
          {groups.length === 0
            ? "Create your first project to get started."
            : `${groups.length} ${groups.length === 1 ? "project" : "projects"} · ${remaining} ${remaining === 1 ? "task" : "tasks"} left`}
        </p>

        {/* Workflow strip: one quiet panel; the step colours are a small data exception to the single-accent rule. */}
        <div className="mt-4 inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-4 py-2.5">
          {[
            { label: "THINK",   color: "#a78bfa" },
            { label: "PLAN",    color: "#60a5fa" },
            { label: "DO",      color: "#34d399" },
            { label: "REFLECT", color: "#ff6b6b" },
          ].map(({ label, color }, i) => (
            <div key={label} className="flex items-center gap-3">
              <span className="flex items-center gap-2 text-xs font-semibold tracking-[0.06em] text-foreground">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} aria-hidden="true" />
                {label}
              </span>
              {i < 3 && <span className="text-subtle" aria-hidden="true">→</span>}
            </div>
          ))}
          <span className="text-base leading-none text-subtle" aria-hidden="true">∞</span>
        </div>
      </div>

      <div className="mb-6">
        <TodaysFrogCard />
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-5 border border-border bg-surface">
            <LayoutGrid className="w-5 h-5 text-subtle" aria-hidden="true" />
          </div>
          <h2 className="text-base font-semibold mb-2 text-foreground">No projects yet</h2>
          <p className="text-sm max-w-xs leading-relaxed text-muted-foreground">
            A project is a board for your tasks. Create one to get started.
          </p>
          <NewProjectButton />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map(group => (
            <Link key={group.id} href={`/group/${group.id}`}
                  className="group relative block rounded-lg border border-border bg-surface p-5 pl-7 transition-colors hover:bg-raised hover:border-border-strong"
                  style={{ borderLeft: `3px solid ${group.color}` }}>
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-md flex items-center justify-center text-sm font-semibold"
                     style={{ background: `${group.color}20`, border: `1px solid ${group.color}40`, color: group.color }}>
                  {group.name.slice(0, 2).toUpperCase()}
                </div>
                <ArrowRight className="w-4 h-4 text-subtle group-hover:text-foreground transition-colors" aria-hidden="true" />
              </div>
              <h2 className="font-semibold text-sm mb-1 text-foreground">{group.name}</h2>
              <p className="text-xs text-subtle tabular">{group.remainingTasks} left</p>
            </Link>
          ))}
        </div>
      )}
    </div>
    </div>
  );
}
