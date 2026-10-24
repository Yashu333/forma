export type Priority = "URGENT" | "HIGH" | "MEDIUM" | "LOW";

// Brian Tracy's ABCDE method: A must / B should / C nice / D delegate / E eliminate.
export type Abcde = "A" | "B" | "C" | "D" | "E";

export interface Group {
  id: string;
  name: string;
  color: string;
  ownerId: string;
  order: number;
  createdAt: string;
  excludeFromReports?: boolean;
  statuses: Status[];
  _count?: { tasks: number };
}

export interface Status {
  id: string;
  name: string;
  groupId: string;
  order: number;
  celebrate: boolean;
  tasks?: Task[];
}

export interface Task {
  id: string;
  title: string;
  description?: string | null;
  groupId: string;
  statusId: string;
  priority: Priority;
  order: number;
  parentTaskId?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  dueDate?: string | null;
  abcde?: Abcde | null;
  abcdeRank?: number | null; // A-1, A-2… within a letter; null = unranked
  plannedFor?: string | null; // local date "YYYY-MM-DD"; null = backlog
  subtasks?: Task[];
  comments?: Comment[];
  activity?: Activity[];
  _count?: { subtasks: number; comments: number };
}

export interface Comment {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  taskId: string;
  userId: string;
  action: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface DailyPlan {
  id: string;
  userId: string;
  date: string; // local date "YYYY-MM-DD"
  frogTaskId?: string | null;
  plannedAt?: string | null;
  reviewedAt?: string | null;
  wentWell?: string | null;
  improve?: string | null;
  rating?: number | null; // 1–5
  createdAt: string;
  updatedAt: string;
  frogTask?: Task | null;
}
