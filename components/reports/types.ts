export interface ReportsData {
  range: { days: number; start: string; end: string; bucketDays: number };
  groups: { id: string; name: string; color: string }[];
  kpis: {
    throughput: number;
    avgCycleTime: number;
    wip: number;
    completionRate: number;
    createdInWindow: number;
    totalTasks: number;
  };
  days: { date: string; completed: number; created: number }[];
  cfd: { date: string; done: number; inProgress: number }[];
  byPriority: { priority: "URGENT" | "HIGH" | "MEDIUM" | "LOW"; total: number; done: number }[];
  byProject: {
    id: string; name: string; color: string;
    total: number; done: number; wip: number; completedInWindow: number;
  }[];
  completedTasks: {
    id: string; title: string;
    priority: "URGENT" | "HIGH" | "MEDIUM" | "LOW";
    completedAt: string; cycleTimeDays: number;
    projectId: string; projectName: string; projectColor: string;
  }[];
  recentActivity: {
    id: string; action: string; createdAt: string;
    taskTitle: string; projectName: string; projectColor: string;
  }[];
}

// Chart palette: Ember chart tokens. Orange marks progress (work completed / in flight),
// success green marks done, warm grey is context. Validated on the surface (#272422):
// each slot is >=3:1 and every chart shows <=2 series with a legend and direct labels,
// so identity never rests on colour alone.
export const CHART = {
  completed: "#F2711C", // primary: work finished in the window
  created: "#B8AFA7",   // muted foreground: work created (context)
  done: "#7DBB8A",      // success
  inProgress: "#F2711C",
};

export const PRIORITY_COLOR: Record<string, string> = {
  URGENT: "#A867C0",
  HIGH: "#DC4E55",
  MEDIUM: "#4A8FA8",
  LOW: "#74869F",
};

export const PRIORITY_LABEL: Record<string, string> = {
  URGENT: "Urgent", HIGH: "High", MEDIUM: "Medium", LOW: "Low",
};

// Cycle time reads oddly as "0.2 days" for same-day work — step down to
// minutes under an hour, hours under a day, days (one decimal) beyond that.
export function formatCycleTime(days: number): string {
  if (days < 1 / 24) {
    const minutes = Math.max(1, Math.round(days * 24 * 60));
    return `${minutes}m`;
  }
  if (days < 1) {
    return `${Math.round(days * 24)}h`;
  }
  return `${Math.round(days * 10) / 10}d`;
}
