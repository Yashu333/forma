import { beforeEach, describe, expect, it } from "vitest";
import { seedGroup, signInAs, setFakeUser } from "./helpers";
import { GET } from "@/app/api/tasks/[id]/route";

const call = (id: string) =>
  GET(new Request(`http://localhost/api/tasks/${id}`), { params: Promise.resolve({ id }) });

describe("GET /api/tasks/[id]", () => {
  let taskId: string;

  beforeEach(async () => {
    const { tasks } = await seedGroup("owner-1", {
      tasks: [{ title: "Parent" }, { title: "Child", parentTitle: "Parent" }],
    });
    taskId = tasks["Parent"].id;
  });

  it("returns 401 when signed out", async () => {
    setFakeUser(null);
    const res = await call(taskId);
    expect(res.status).toBe(401);
  });

  it("returns the task with its subtasks for a signed-in user", async () => {
    signInAs("owner-1");
    const res = await call(taskId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("Parent");
    expect(body.subtasks.map((s: { title: string }) => s.title)).toEqual(["Child"]);
  });

  it("returns 404 for an unknown id", async () => {
    signInAs("owner-1");
    const res = await call("does-not-exist");
    expect(res.status).toBe(404);
  });
});
