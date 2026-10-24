// Shared by today-get / today-candidates / today-put integration tests.
import { expect } from "vitest";
import { db } from "@/lib/db";
import { seedGroup } from "./helpers";
import { GET as getToday, PUT as putToday } from "@/app/api/today/route";
import { GET as getCandidates } from "@/app/api/today/candidates/route";

export type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const DATE = "2026-10-24";
export const TZ = "America/New_York";

export function callGet(query: string | Record<string, string>) {
  const qs = typeof query === "string" ? query : new URLSearchParams(query).toString();
  return getToday(new Request(`http://localhost/api/today?${qs}`));
}
export const get = (date = DATE, tz = TZ) => callGet({ date, tz });

export function callCandidates(query = "") {
  // The handler declares no parameter, but Next still hands it the Request.
  return (getCandidates as (req: Request) => Promise<Response>)(new Request(`http://localhost/api/today/candidates${query}`));
}

/** PUT with a verbatim string body (to test non-JSON), or any value JSON.stringify'd. */
export function putRaw(raw: string) {
  return putToday(
    new Request("http://localhost/api/today", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: raw,
    }),
  );
}
export const put = (body: unknown) => putRaw(JSON.stringify(body));

/** Drops undefined keys from a body, so a test can say `{ ...base, frogTaskId: undefined }` to omit one. */
export const body = (o: Record<string, unknown>) => JSON.parse(JSON.stringify(o));

/** Everything a PUT could possibly touch, for "nothing was written" assertions. */
export async function snapshot() {
  return {
    tasks: await db.task.findMany({ orderBy: { id: "asc" } }),
    plans: await db.dailyPlan.findMany({ orderBy: { id: "asc" } }),
    activity: await db.activity.findMany({ orderBy: { id: "asc" } }),
    comments: await db.comment.findMany({ orderBy: { id: "asc" } }),
  };
}

/** A second user whose data must never show up in user-1's responses. */
export async function seedForeignUser(date = DATE) {
  const seeded = await seedGroup("stranger", {
    groupName: "SECRET-GROUP",
    tasks: [
      { title: "SECRET planned", extra: { abcde: "A", abcdeRank: 1, plannedFor: date } },
      { title: "SECRET backlog", extra: { abcde: "B" } },
      { title: "SECRET done", status: "Done", completedAt: new Date(`${date}T15:00:00Z`) },
      { title: "SECRET frog", extra: { plannedFor: date } },
      { title: "SECRET frog sub", parentTitle: "SECRET frog", extra: { plannedFor: date } },
    ],
  });
  await db.dailyPlan.create({
    data: { userId: "stranger", date, frogTaskId: seeded.tasks["SECRET frog"].id, wentWell: "SECRET reflection" },
  });
  return seeded;
}

/** Asserts nothing of the foreign user's leaked into a response body (by title, group name, id or text). */
export function expectNoForeignData(res: unknown, foreign: Awaited<ReturnType<typeof seedForeignUser>>) {
  const text = JSON.stringify(res);
  expect(text).not.toContain("SECRET");
  expect(text).not.toContain("stranger");
  expect(text).not.toContain(foreign.group.id);
  for (const t of Object.values(foreign.tasks)) expect(text).not.toContain(t.id);
}

/** `o` without the listed keys. */
export const omit = <T extends Record<string, unknown>>(o: T, ...keys: string[]) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

export const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
export const titles = (xs: { title: string }[]) => xs.map((x) => x.title);
