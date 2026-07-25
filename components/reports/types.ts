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

// Chart palette — drawn from Forma's own theme tokens. Validated against the
// dark card surface (#282A42): CVD separation 64+, contrast >=3:1 on all slots.
// Each chart shows <=2 series and carries a legend + direct labels, so identity
// never rests on color alone.
export const CHART = {
  completed: "#7C6EF8", // accent violet — work finished
  created: "#7E82A8",   // muted secondary — work created (context)
  done: "#34D399",      // emerald — matches the app's "done" status color
  inProgress: "#7C6EF8",
};

export const PRIORITY_COLOR: Record<string, string> = {
  URGENT: "#9B59B6",
  HIGH: "#C0531A",
  MEDIUM: "#4A8FA8",
  LOW: "#475569",
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
