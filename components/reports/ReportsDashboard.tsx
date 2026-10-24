"use client";

import { useState, useEffect, useCallback } from "react";
import { format, parseISO } from "date-fns";
import { BarChart3, Clock, Layers, CheckCircle2, ChevronDown, ArrowUpRight, TrendingUp, Activity as ActivityIcon, Loader2 } from "lucide-react";
import { ReportsData, CHART, PRIORITY_COLOR, PRIORITY_LABEL, formatCycleTime } from "./types";
import ThroughputChart from "./ThroughputChart";
import CumulativeFlowChart from "./CumulativeFlowChart";
import BreakdownBars from "./BreakdownBars";
import CompletedTasksModal from "./CompletedTasksModal";
import FrogSection from "./FrogSection";

const RANGES: { days: number | "all"; label: string }[] = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: "all", label: "All time" },
];

const ACTION_LABEL: Record<string, string> = {
  created: "created", status_changed: "moved", archived: "archived",
  restored: "restored", deleted: "deleted",
};

export default function ReportsDashboard() {
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [groupId, setGroupId] = useState<string>("");
  const [days, setDays] = useState<number | "all">(30);
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (groupId) qs.set("groupId", groupId);
    qs.set("days", String(days));
    const res = await fetch(`/api/reports?${qs.toString()}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [groupId, days]);

  useEffect(() => { load(); }, [load]);

  const activeProject = data?.groups.find(g => g.id === groupId);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-5 md:p-7 max-w-6xl mx-auto text-foreground">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
          <div>
            <h1 className="text-[28px] sm:text-4xl font-semibold tracking-[-0.025em] leading-[1.1] flex items-center gap-3">
              <BarChart3 className="w-6 h-6 text-subtle" aria-hidden="true" />
              Reports
            </h1>
            <p className="text-sm mt-2 text-muted-foreground tabular">
              {activeProject ? activeProject.name : "All projects"}
              {data && ` · ${format(parseISO(data.range.start), "MMM d")} – ${format(parseISO(data.range.end), "MMM d")}`}
            </p>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Project filter */}
            <div className="relative">
              <button
                onClick={() => setShowGroupMenu(v => !v)}
                onBlur={() => setTimeout(() => setShowGroupMenu(false), 150)}
                aria-haspopup="listbox"
                aria-expanded={showGroupMenu}
                className="flex items-center gap-2 h-9 px-3 rounded-lg text-sm border border-border bg-surface text-foreground transition-colors hover:bg-raised"
              >
                {activeProject ? (
                  <span className="w-2 h-2 rounded-full" style={{ background: activeProject.color }} aria-hidden="true" />
                ) : (
                  <Layers className="w-3.5 h-3.5 text-subtle" aria-hidden="true" />
                )}
                <span className="max-w-[140px] truncate">{activeProject ? activeProject.name : "All projects"}</span>
                <ChevronDown className="w-3.5 h-3.5 text-subtle" aria-hidden="true" />
              </button>
              {showGroupMenu && (
                <div className="dropdown-menu absolute top-full mt-1 right-0 min-w-[180px] max-h-[280px] overflow-y-auto animate-in-up">
                  <button className="dropdown-item first:pt-2" onMouseDown={() => { setGroupId(""); setShowGroupMenu(false); }}>
                    <Layers className="w-3.5 h-3.5 text-subtle" aria-hidden="true" /> All projects
                  </button>
                  {data?.groups.map(g => (
                    <button key={g.id} className="dropdown-item last:pb-2" onMouseDown={() => { setGroupId(g.id); setShowGroupMenu(false); }}>
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: g.color }} aria-hidden="true" />
                      <span className="truncate">{g.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Date range segmented control */}
            <div className="flex items-center rounded-lg border border-border bg-surface p-1" role="group" aria-label="Date range">
              {RANGES.map(r => (
                <button key={r.days} onClick={() => setDays(r.days)}
                  aria-pressed={days === r.days}
                  className={`h-7 px-2.5 rounded-md text-xs font-medium transition-colors ${
                    days === r.days
                      ? "bg-primary-soft ring-1 ring-inset ring-primary text-foreground"
                      : "text-muted-foreground hover:bg-raised"
                  }`}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading && !data ? (
          <div role="status" className="flex items-center justify-center gap-2 py-32 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin text-primary" aria-hidden="true" />
            Loading reports…
          </div>
        ) : !data || data.kpis.totalTasks === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity 0.15s" }}>
            {/* KPI row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <StatTile icon={<TrendingUp className="w-4 h-4" aria-hidden="true" />} label="Completed"
                value={data.kpis.throughput} suffix={days === "all" ? "all time" : `in ${days}d`}
                onClick={() => setShowCompleted(true)} />
              <StatTile icon={<Clock className="w-4 h-4" aria-hidden="true" />} label="Avg cycle time"
                value={data.kpis.avgCycleTime} display={formatCycleTime(data.kpis.avgCycleTime)} />
              <StatTile icon={<Layers className="w-4 h-4" aria-hidden="true" />} label="In progress"
                value={data.kpis.wip} suffix="active" />
              <StatTile icon={<CheckCircle2 className="w-4 h-4" aria-hidden="true" />} label="Completion rate"
                value={data.kpis.completionRate} suffix="%" />
            </div>

            {/* Throughput chart */}
            <Card title="Throughput" subtitle={`Tasks completed vs created per day`}
                  legend={[{ color: CHART.completed, label: "Completed" }, { color: CHART.created, label: "Created" }]}>
              <ThroughputChart days={data.days} />
            </Card>

            {/* CFD + breakdowns */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              <Card title="Cumulative flow" subtitle="Work accumulating over time"
                    legend={[{ color: CHART.inProgress, label: "In progress" }, { color: CHART.done, label: "Done" }]}>
                <CumulativeFlowChart cfd={data.cfd} />
              </Card>

              <Card title="By priority" subtitle="Done / total per priority level">
                <BreakdownBars rows={data.byPriority.map(p => ({
                  label: PRIORITY_LABEL[p.priority], color: PRIORITY_COLOR[p.priority],
                  total: p.total, done: p.done,
                }))} />
              </Card>
            </div>

            {/* Project breakdown + activity */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              <Card title="By project" subtitle="Done / total per project">
                <BreakdownBars rows={data.byProject.map(p => ({
                  label: p.name, color: p.color, total: p.total, done: p.done,
                }))} />
              </Card>

              <Card title="Recent activity" subtitle="Latest changes across your tasks">
                {data.recentActivity.length === 0 ? (
                  <p className="text-[13px] text-subtle">No recent activity.</p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {data.recentActivity.map(a => (
                      <div key={a.id} className="flex items-center gap-2.5 text-sm">
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: a.projectColor }} aria-hidden="true" />
                        <span className="flex-1 min-w-0 truncate text-muted-foreground">
                          <span className="text-subtle">{ACTION_LABEL[a.action] ?? a.action} </span>
                          <span className="text-foreground">{a.taskTitle}</span>
                        </span>
                        <span className="text-xs flex-shrink-0 text-subtle tabular">
                          {format(parseISO(a.createdAt), "MMM d")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}

        {/* Independent of the task report: it has its own fetch, so it shows for an
            empty project or a failed /api/reports, and doesn't dim with the task charts. */}
        {!(loading && !data) && <FrogSection days={days} projectFilterActive={!!groupId} />}
      </div>

      {showCompleted && data && (
        <CompletedTasksModal
          tasks={data.completedTasks}
          groups={data.groups}
          rangeLabel={days === "all" ? "all time" : `last ${days} days`}
          onClose={() => setShowCompleted(false)}
        />
      )}
    </div>
  );
}

function StatTile({ icon, label, value, suffix, decimals, onClick, display }: {
  icon: React.ReactNode; label: string; value: number; suffix?: string; decimals?: boolean;
  onClick?: () => void; display?: string;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={`rounded-lg border border-border bg-surface p-4 ${
        onClick ? "text-left transition-colors w-full group hover:bg-raised hover:border-border-strong" : ""
      }`}
    >
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2 text-subtle">
          {icon}
          <span className="text-xs font-medium">{label}</span>
        </div>
        {onClick && (
          <ArrowUpRight className="w-3.5 h-3.5 text-subtle opacity-100 sm:opacity-0 sm:group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity" aria-hidden="true" />
        )}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tracking-[-0.02em] text-foreground tabular">
          {display ?? (decimals ? value.toFixed(1) : value)}
        </span>
        {suffix && <span className="text-xs text-subtle">{suffix}</span>}
      </div>
    </Comp>
  );
}

function Card({ title, subtitle, legend, children }: {
  title: string; subtitle?: string;
  legend?: { color: string; label: string }[];
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="text-xs mt-0.5 text-subtle">{subtitle}</p>}
        </div>
        {legend && (
          <div className="flex items-center gap-3 flex-shrink-0">
            {legend.map(l => (
              <span key={l.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: l.color }} aria-hidden="true" />
                {l.label}
              </span>
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-5 border border-border bg-surface">
        <ActivityIcon className="w-5 h-5 text-subtle" aria-hidden="true" />
      </div>
      <h2 className="text-base font-semibold mb-2 text-foreground">No data to report yet</h2>
      <p className="text-sm max-w-xs leading-relaxed text-muted-foreground">
        Create tasks and move them through your board. As work completes, your throughput,
        cycle time and flow metrics will appear here.
      </p>
    </div>
  );
}
