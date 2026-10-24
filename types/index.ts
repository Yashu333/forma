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
  completedAt?: string | null; // set while the task sits in a celebrate ("done") status
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

// ── Payloads of the Today API (GET/PUT /api/today, GET /api/today/candidates) ──
// `db` is typed any on the server, so these mirror lib/frog/today.server.ts and
// app/api/today/candidates/route.ts by hand. Dates arrive as ISO strings.

export interface TodayGroup {
  id: string;
  name: string;
  color: string;
  /** First celebrate status by board order; null when the project has no Done column. */
  doneStatusId: string | null;
}

/** A top-level task planned for the requested date, done or not (`completedAt` set = done). */
export type TodayTask = Task & { group: TodayGroup };

/**
 * The plan's frog with its project and its open (not deleted/archived) subtasks.
 * `archivedAt` is set when the task was filed away: the API still returns an
 * archived frog (so an eaten one keeps showing as eaten); see `activeFrog`.
 */
export type TodayFrog = Task & { group: TodayGroup; subtasks: Task[]; archivedAt?: string | null };

export interface TodayCompletedTask {
  id: string;
  title: string;
  abcde: Abcde | null;
  abcdeRank: number | null;
  completedAt: string;
  group: { id: string; name: string; color: string };
}

export interface TodayPayload {
  date: string;
  plan: DailyPlan | null;
  frog: TodayFrog | null;
  tasks: TodayTask[];
  completedToday: TodayCompletedTask[];
  openA: number;
  streak: { current: number; longest: number };
  /** The user's frog-first setting (UserSettings.frogFirstMode); false when they have no settings row. */
  frogFirstMode: boolean;
}

/** One open task the plan picker can offer (GET /api/today/candidates returns an array of these). */
export interface TodayCandidate {
  id: string;
  title: string;
  groupId: string;
  statusId: string;
  priority: Priority;
  order: number;
  abcde: Abcde | null;
  abcdeRank: number | null;
  plannedFor: string | null;
  dueDate: string | null;
  group: { id: string; name: string; color: string };
}

/** One open task on the Label tasks screen (GET /api/abcde `tasks`, newest first). */
export interface LabelTask {
  id: string;
  title: string;
  abcde: Abcde | null;
  abcdeRank: number | null;
  plannedFor: string | null;
  createdAt: string;
  group: { id: string; name: string; color: string };
}

/** A project new tasks can be added to (GET /api/abcde `projects`). */
export interface LabelProject {
  id: string;
  name: string;
  color: string;
}
