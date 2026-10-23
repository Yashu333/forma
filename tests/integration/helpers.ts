// Shared helpers for integration tests. The Supabase mock and the per-test
// reset (signed-out user + empty DB) live in setup.ts and apply to every test
// file automatically; nothing needs to be imported first.
import { db } from "@/lib/db";
import { fakeAuth, type FakeUser } from "./fake-user";

export type { FakeUser };

/** Sets who the route handlers see as the signed-in user; null = signed out. */
export function setFakeUser(user: FakeUser | null) {
  fakeAuth.user = user;
}

/** Signs in as `id` (default "user-1") and returns the user. Call again mid-test to switch users. */
export function signInAs(id = "user-1"): FakeUser {
  const user = { id, email: `${id}@example.test` };
  fakeAuth.user = user;
  return user;
}

/** Refuse to TRUNCATE anything but a local throwaway database. */
function assertSafeTestDb() {
  const raw = process.env.DATABASE_URL ?? "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("resetDb: DATABASE_URL is missing or invalid");
  }
  const dbName = url.pathname.replace(/^\//, "");
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (!local || !dbName.endsWith("_test")) {
    throw new Error(
      `resetDb: refusing to truncate "${dbName}" on "${url.hostname}"; only local *_test databases are allowed`
    );
  }
}

/**
 * Empties every table (except Prisma's migration bookkeeping). Tables are read
 * from pg_tables so models added by later migrations are covered without
 * touching this file.
 */
export async function resetDb() {
  assertSafeTestDb();
  const rows: { tablename: string }[] = await db.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename.replace(/"/g, '""')}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

interface SeedOptions {
  /** Statuses to create, in board order. Defaults to To Do / In Progress / Done (celebrate). */
  statuses?: { name: string; celebrate?: boolean }[];
  groupName?: string;
  excludeFromReports?: boolean;
  /** Tasks to create; `status` is the status name (default: first status). */
  tasks?: {
    title: string;
    status?: string;
    priority?: "URGENT" | "HIGH" | "MEDIUM" | "LOW";
    completedAt?: Date | null;
    archivedAt?: Date | null;
    deletedAt?: Date | null;
    parentTitle?: string; // make this a subtask of an earlier task in the list
    // Extra raw columns (e.g. new fields added by later milestones).
    extra?: Record<string, unknown>;
  }[];
}

/**
 * Creates a group owned by `ownerId` with statuses and tasks.
 * Returns the rows plus name->row lookups for convenience.
 */
export async function seedGroup(ownerId: string, opts: SeedOptions = {}) {
  const statusDefs = opts.statuses ?? [
    { name: "To Do" },
    { name: "In Progress" },
    { name: "Done", celebrate: true },
  ];
  const group = await db.group.create({
    data: {
      name: opts.groupName ?? "Test project",
      ownerId,
      excludeFromReports: opts.excludeFromReports ?? false,
    },
  });

  const statuses: Record<string, { id: string; name: string; celebrate: boolean }> = {};
  for (const [i, s] of statusDefs.entries()) {
    statuses[s.name] = await db.status.create({
      data: { name: s.name, groupId: group.id, order: i, celebrate: s.celebrate ?? false },
    });
  }

  const tasks: Record<string, { id: string; title: string; [k: string]: unknown }> = {};
  for (const [i, t] of (opts.tasks ?? []).entries()) {
    const status = statuses[t.status ?? statusDefs[0].name];
    if (!status) throw new Error(`seedGroup: unknown status "${t.status}"`);
    const parent = t.parentTitle ? tasks[t.parentTitle] : undefined;
    if (t.parentTitle && !parent) throw new Error(`seedGroup: unknown parent "${t.parentTitle}"`);
    tasks[t.title] = await db.task.create({
      data: {
        title: t.title,
        groupId: group.id,
        statusId: status.id,
        priority: t.priority ?? "MEDIUM",
        order: i,
        createdBy: ownerId,
        parentTaskId: parent?.id ?? null,
        completedAt: t.completedAt ?? (status.celebrate ? new Date() : null),
        archivedAt: t.archivedAt ?? null,
        deletedAt: t.deletedAt ?? null,
        ...t.extra,
      },
    });
  }

  return { group, statuses, tasks };
}
