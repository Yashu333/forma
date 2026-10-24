// M3: GET /api/today/candidates (the Plan-my-day picker's source list).
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { seedGroup, signInAs, setFakeUser } from "./helpers";
import { callCandidates, seedForeignUser, expectNoForeignData, titles, type Json } from "./today-helpers";

describe("GET /api/today/candidates", () => {
  beforeEach(() => {
    signInAs("owner-1");
  });

  describe("auth", () => {
    it("401 with no user", async () => {
      await seedGroup("owner-1", { tasks: [{ title: "T" }] });
      setFakeUser(null);
      const res = await callCandidates();
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    });
  });

  describe("input", () => {
    // The route takes no input. There is nothing to 400 on: the query string is ignored.
    it("ignores a query string, however odd (no 400, no 500)", async () => {
      await seedGroup("owner-1", { tasks: [{ title: "T" }] });
      for (const q of ["?date=garbage&tz=Mars/Base", "?date=2026-02-30", "?tz=%2B05:00", "?groupId[]=x", "?" + "a=1&".repeat(500)]) {
        const res = await callCandidates(q);
        expect(res.status).toBe(200);
        expect(titles(await res.json())).toEqual(["T"]);
      }
    });
  });

  it("an empty account gets []", async () => {
    const res = await callCandidates();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  describe("which tasks", () => {
    it("only open, top-level, live tasks the user owns", async () => {
      await seedGroup("owner-1", {
        statuses: [{ name: "To Do" }, { name: "Doing" }, { name: "Done", celebrate: true }, { name: "Shipped", celebrate: true }],
        tasks: [
          { title: "todo" },
          { title: "doing", status: "Doing" },
          { title: "done", status: "Done" },
          { title: "shipped", status: "Shipped" },
          { title: "trashed", deletedAt: new Date() },
          { title: "archived", archivedAt: new Date() },
          { title: "archived+trashed", archivedAt: new Date(), deletedAt: new Date() },
          { title: "parent" },
          { title: "sub open", parentTitle: "parent" },
          { title: "sub of nobody-special", parentTitle: "todo" },
        ],
      });
      const res = await callCandidates();
      expect(titles(await res.json()).sort()).toEqual(["doing", "parent", "todo"]);
    });

    it("includes tasks already planned for today, for another day, or the backlog (with plannedFor so the picker can show it)", async () => {
      await seedGroup("owner-1", {
        tasks: [
          { title: "planned today", extra: { plannedFor: "2026-10-24" } },
          { title: "planned later", extra: { plannedFor: "2026-12-01" } },
          { title: "backlog" },
        ],
      });
      const out: Json[] = await (await callCandidates()).json();
      expect(Object.fromEntries(out.map((t) => [t.title, t.plannedFor]))).toEqual({
        "planned today": "2026-10-24",
        "planned later": "2026-12-01",
        backlog: null,
      });
    });

    it("a task that is open but has a stale completedAt is still a candidate (celebrate status is the source of truth)", async () => {
      await seedGroup("owner-1", { tasks: [{ title: "reopened", extra: { completedAt: new Date() } }] });
      expect(titles(await (await callCandidates()).json())).toEqual(["reopened"]);
    });

    it("moving a task into a celebrate status removes it, moving it back returns it", async () => {
      const { tasks, statuses } = await seedGroup("owner-1", { tasks: [{ title: "T" }] });
      await db.task.update({ where: { id: tasks["T"].id }, data: { statusId: statuses["Done"].id } });
      expect(await (await callCandidates()).json()).toEqual([]);
      await db.task.update({ where: { id: tasks["T"].id }, data: { statusId: statuses["To Do"].id } });
      expect(titles(await (await callCandidates()).json())).toEqual(["T"]);
    });

    it("a group with no celebrate status contributes all of its non-deleted tasks", async () => {
      await seedGroup("owner-1", { statuses: [{ name: "Open" }], tasks: [{ title: "x" }, { title: "y" }] });
      expect(titles(await (await callCandidates()).json()).sort()).toEqual(["x", "y"]);
    });
  });

  describe("shape", () => {
    it("has the task and ABCDE fields plus group {id, name, color} and nothing else about the group", async () => {
      const { group, statuses, tasks } = await seedGroup("owner-1", {
        groupName: "Work",
        tasks: [{ title: "T", priority: "HIGH", extra: { abcde: "B", abcdeRank: 4, plannedFor: "2026-10-25", dueDate: new Date("2026-11-01T00:00:00Z") } }],
      });
      const out: Json[] = await (await callCandidates()).json();
      expect(out).toHaveLength(1);
      expect(out[0]).toEqual({
        id: tasks["T"].id,
        title: "T",
        groupId: group.id,
        statusId: statuses["To Do"].id,
        priority: "HIGH",
        order: 0,
        abcde: "B",
        abcdeRank: 4,
        plannedFor: "2026-10-25",
        dueDate: "2026-11-01T00:00:00.000Z",
        group: { id: group.id, name: "Work", color: group.color },
      });
    });

    it("unlabelled tasks have null abcde / abcdeRank / plannedFor / dueDate", async () => {
      await seedGroup("owner-1", { tasks: [{ title: "plain" }] });
      const [t]: Json[] = await (await callCandidates()).json();
      expect(t).toMatchObject({ abcde: null, abcdeRank: null, plannedFor: null, dueDate: null });
    });

    it("does not leak the group's sort key or other columns", async () => {
      await seedGroup("owner-1", { tasks: [{ title: "T" }] });
      const [t]: Json[] = await (await callCandidates()).json();
      expect(Object.keys(t.group).sort()).toEqual(["color", "id", "name"]);
      for (const k of ["description", "createdBy", "deletedAt", "archivedAt", "completedAt", "parentTaskId"]) {
        expect(k in t).toBe(false);
      }
    });
  });

  describe("sorting", () => {
    it("by project order first, then compareTasks within a project", async () => {
      const p1 = await seedGroup("owner-1", {
        groupName: "First",
        tasks: [
          { title: "p1 none", priority: "URGENT" },
          { title: "p1 B", extra: { abcde: "B" } },
          { title: "p1 A-2", extra: { abcde: "A", abcdeRank: 2 } },
          { title: "p1 A-1", extra: { abcde: "A", abcdeRank: 1 } },
        ],
      });
      const p2 = await seedGroup("owner-1", {
        groupName: "Second",
        tasks: [
          { title: "p2 C", extra: { abcde: "C" } },
          { title: "p2 A", extra: { abcde: "A" } },
          { title: "p2 none-low", priority: "LOW" },
          { title: "p2 none-high", priority: "HIGH" },
        ],
      });
      // Make the project that was created FIRST sort LAST, so the order isn't just insertion order.
      await db.group.update({ where: { id: p1.group.id }, data: { order: 5 } });
      await db.group.update({ where: { id: p2.group.id }, data: { order: 1.5 } });
      expect(titles(await (await callCandidates()).json())).toEqual([
        "p2 A",
        "p2 C",
        "p2 none-high",
        "p2 none-low",
        "p1 A-1",
        "p1 A-2",
        "p1 B",
        "p1 none",
      ]);
    });

    it("projects with equal order never interleave", async () => {
      await seedGroup("owner-1", { groupName: "X", tasks: [{ title: "x B", extra: { abcde: "B" } }, { title: "x A", extra: { abcde: "A" } }] });
      await seedGroup("owner-1", { groupName: "Y", tasks: [{ title: "y A", extra: { abcde: "A" } }, { title: "y B", extra: { abcde: "B" } }] });
      const out: Json[] = await (await callCandidates()).json();
      const groups = out.map((t) => t.group.name);
      expect(groups.join("")).toMatch(/^(XX|YY)(XX|YY)$/);
      for (const g of ["X", "Y"]) expect(titles(out.filter((t) => t.group.name === g))).toEqual([`${g.toLowerCase()} A`, `${g.toLowerCase()} B`]);
    });

    it("a project's tasks come out in board order when there is a full tie", async () => {
      await seedGroup("owner-1", { tasks: [{ title: "one" }, { title: "two" }, { title: "three" }] });
      expect(titles(await (await callCandidates()).json())).toEqual(["one", "two", "three"]);
    });
  });

  describe("isolation and the excludeFromReports flag", () => {
    it("never includes another user's tasks, and none of their data leaks", async () => {
      const foreign = await seedForeignUser();
      await seedGroup("owner-1", { tasks: [{ title: "mine" }] });
      const out = await (await callCandidates()).json();
      expect(titles(out)).toEqual(["mine"]);
      expectNoForeignData(out, foreign);
      signInAs("stranger");
      const theirs = await (await callCandidates()).json();
      expect(titles(theirs)).not.toContain("mine");
      expect(titles(theirs)).toContain("SECRET planned");
    });

    // SPEC.md: excludeFromReports appears only under the Reports milestones (M6: "excludeFromReports respected"
    // for the frog stats). Nothing in the Today / candidates contract mentions it, and the picker lists "every
    // active top-level task the user owns". So a project excluded from reports is STILL a candidate.
    it("a project with excludeFromReports: true is still included (that flag is about reports only)", async () => {
      await seedGroup("owner-1", { groupName: "Hidden from reports", excludeFromReports: true, tasks: [{ title: "quiet task" }] });
      await seedGroup("owner-1", { groupName: "Reported", tasks: [{ title: "loud task" }] });
      const out: Json[] = await (await callCandidates()).json();
      expect(titles(out).sort()).toEqual(["loud task", "quiet task"]);
      expect(out.find((t) => t.title === "quiet task")!.group.name).toBe("Hidden from reports");
    });
  });

  describe("scale", () => {
    it("500 tasks across 10 projects: one fast, correct response", async () => {
      const groups = [];
      for (let g = 0; g < 10; g++) groups.push(await seedGroup("owner-1", { groupName: `P${g}` }));
      for (const [g, seeded] of groups.entries()) {
        await db.group.update({ where: { id: seeded.group.id }, data: { order: 9 - g } });
        await db.task.createMany({
          data: Array.from({ length: 50 }, (_, i) => ({
            title: `P${g} t${i}`,
            groupId: seeded.group.id,
            statusId: i % 5 === 0 ? seeded.statuses["Done"].id : seeded.statuses["To Do"].id,
            createdBy: "owner-1",
            order: i,
            abcde: (["A", "B", "C", "D", "E"] as const)[i % 5],
          })),
        });
      }
      const t0 = Date.now();
      const res = await callCandidates();
      const elapsed = Date.now() - t0;
      expect(res.status).toBe(200);
      const out: Json[] = await res.json();
      expect(out).toHaveLength(400); // every 5th task (i%5==0) is Done
      expect(out[0].group.name).toBe("P9"); // lowest group.order first
      expect(elapsed).toBeLessThan(3000);
    });
  });
});
