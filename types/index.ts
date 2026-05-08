export type Priority = "URGENT" | "HIGH" | "MEDIUM" | "LOW";

export interface Group {
  id: string;
  name: string;
  color: string;
  ownerId: string;
  order: number;
  createdAt: string;
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
