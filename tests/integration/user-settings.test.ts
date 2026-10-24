// M7: GET/PUT /api/user-settings and the `frogFirstMode` flag. Real handlers +
// real Postgres; every test asserts the DB row afterwards (`db` is typed any, so
// a typo in a field name only shows up here).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { seedGroup, signInAs, setFakeUser } from "./helpers";
import { GET, PUT } from "@/app/api/user-settings/route";
import { POST as postReview } from "@/app/api/today/review/route";
import { DATE, TZ, get, put as putToday, type Json } from "./today-helpers";

const putRaw = (raw: string) =>
  PUT(new Request("http://localhost/api/user-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: raw }));
const put = (body: unknown) => putRaw(JSON.stringify(body));

const row = (userId = "u1") => db.userSettings.findUnique({ where: { userId } });
const count = () => db.userSettings.count();

const TIMER = { focusMins: 50, shortMins: 10, longMins: 30, sessionsBeforeLong: 3, autoStartBreaks: true, autoStartFocus: true };
const DEFAULTS = { focusMins: 25, shortMins: 5, longMins: 15, sessionsBeforeLong: 4, autoStartBreaks: false, autoStartFocus: false };

// The Pomodoro page's saved body: the timer config only, never frogFirstMode.
const POMODORO_BODY = { focusMins: 40, shortMins: 7, longMins: 20, sessionsBeforeLong: 5, autoStartBreaks: true, autoStartFocus: false };

const SPOTIFY = {
  spotifyAccessToken: "ACCESS-TOKEN-u1",
  spotifyRefreshToken: "REFRESH-TOKEN-u1",
  spotifyTokenExpiresAt: new Date("2026-12-01T10:00:00Z"),
};
const SPOTIFY_OTHER = {
  spotifyAccessToken: "ACCESS-TOKEN-u2",
  spotifyRefreshToken: "REFRESH-TOKEN-u2",
  spotifyTokenExpiresAt: new Date("2026-12-02T10:00:00Z"),
};

beforeEach(() => {
  signInAs("u1");
});

describe("auth", () => {
  it("401 on GET and PUT with no user, and nothing is written", async () => {
    setFakeUser(null);
    expect((await GET()).status).toBe(401);
    expect((await put({ frogFirstMode: true })).status).toBe(401);
    expect((await put(POMODORO_BODY)).status).toBe(401);
    expect(await count()).toBe(0);
  });

  it("401 comes before body validation (invalid JSON, bad value)", async () => {
    setFakeUser(null);
    expect((await putRaw("{nope")).status).toBe(401);
    expect((await put({ frogFirstMode: "yes" })).status).toBe(401);
    expect(await count()).toBe(0);
  });

  it("401 leaves an existing row untouched", async () => {
    await db.userSettings.create({ data: { userId: "u1", focusMins: 33 } });
    setFakeUser(null);
    expect((await put({ focusMins: 99, frogFirstMode: true })).status).toBe(401);
    expect(await row()).toMatchObject({ focusMins: 33, frogFirstMode: false });
  });
});

describe("GET /api/user-settings", () => {
  it("with no row: the exact default shape, including frogFirstMode:false, and no row is created", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...DEFAULTS, frogFirstMode: false });
    expect(await count()).toBe(0);
  });

  it("with a row: returns the stored values and frogFirstMode", async () => {
    await db.userSettings.create({ data: { userId: "u1", ...TIMER, frogFirstMode: true } });
    const b: Json = await (await GET()).json();
    expect(b).toMatchObject({ userId: "u1", ...TIMER, frogFirstMode: true });
    expect(typeof b.id).toBe("string");
  });

  it("a row created without frogFirstMode reads back false (the column default)", async () => {
    await db.userSettings.create({ data: { userId: "u1" } });
    expect(await (await GET()).json()).toMatchObject({ ...DEFAULTS, frogFirstMode: false });
  });

  it("returns only the caller's row", async () => {
    await db.userSettings.create({ data: { userId: "u2", focusMins: 99, frogFirstMode: true, ...SPOTIFY_OTHER } });
    // u1 has no row: gets the defaults, not u2's values
    expect(await (await GET()).json()).toEqual({ ...DEFAULTS, frogFirstMode: false });
    await db.userSettings.create({ data: { userId: "u1", focusMins: 11, frogFirstMode: false } });
    const b: Json = await (await GET()).json();
    expect(b).toMatchObject({ userId: "u1", focusMins: 11, frogFirstMode: false });
    expect(JSON.stringify(b)).not.toContain("u2");
  });
});

describe("PUT /api/user-settings: creating the row", () => {
  it("{frogFirstMode:true} on an account with no row creates it with the schema defaults for the timer fields", async () => {
    const res = await put({ frogFirstMode: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ userId: "u1", ...DEFAULTS, frogFirstMode: true });
    expect(await count()).toBe(1);
    expect(await row()).toMatchObject({ ...DEFAULTS, frogFirstMode: true, spotifyAccessToken: null, spotifyRefreshToken: null, spotifyTokenExpiresAt: null });
  });

  it("{frogFirstMode:false} with no row creates it with false and the defaults", async () => {
    expect((await put({ frogFirstMode: false })).status).toBe(200);
    expect(await row()).toMatchObject({ ...DEFAULTS, frogFirstMode: false });
  });

  it("{} with no row creates a row with every default (frogFirstMode false)", async () => {
    expect((await put({})).status).toBe(200);
    expect(await row()).toMatchObject({ ...DEFAULTS, frogFirstMode: false });
  });

  it("a Pomodoro-style body with no row creates the row; frogFirstMode takes the default false", async () => {
    const res = await put(POMODORO_BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ...POMODORO_BODY, frogFirstMode: false });
    expect(await row()).toMatchObject({ ...POMODORO_BODY, frogFirstMode: false });
  });

  it("a full body including frogFirstMode creates everything as sent", async () => {
    expect((await put({ ...TIMER, frogFirstMode: true })).status).toBe(200);
    expect(await row()).toMatchObject({ ...TIMER, frogFirstMode: true });
  });
});

describe("PUT /api/user-settings: the Pomodoro page must not reset frogFirstMode", () => {
  beforeEach(async () => {
    await db.userSettings.create({ data: { userId: "u1", frogFirstMode: true, ...SPOTIFY } });
  });

  it("a full Pomodoro body WITHOUT frogFirstMode leaves it true and updates the timer fields exactly", async () => {
    const res = await put(POMODORO_BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ...POMODORO_BODY, frogFirstMode: true });
    expect(await row()).toMatchObject({ ...POMODORO_BODY, frogFirstMode: true, ...SPOTIFY });
  });

  it("works for every timer field on its own (each change is stored, frogFirstMode stays)", async () => {
    for (const [k, v] of Object.entries(TIMER)) {
      expect((await put({ [k]: v })).status).toBe(200);
      const r = await row();
      expect(r[k as keyof typeof r]).toBe(v);
      expect(r.frogFirstMode).toBe(true);
    }
    expect(await row()).toMatchObject({ ...TIMER, frogFirstMode: true });
  });

  it("the whole GET row echoed back (what the Pomodoro page really sends: id, userId, tokens included) keeps the flag and the tokens", async () => {
    const echoed: Json = await (await GET()).json();
    expect(echoed.frogFirstMode).toBe(true);
    const res = await put({ ...echoed, focusMins: 45 });
    expect(res.status).toBe(200);
    expect(await row()).toMatchObject({ focusMins: 45, frogFirstMode: true, ...SPOTIFY });
  });

  it("extra unknown fields are ignored", async () => {
    expect((await put({ ...POMODORO_BODY, bogus: 1, userId: "u2", id: "x" })).status).toBe(200);
    expect(await row("u1")).toMatchObject({ ...POMODORO_BODY, frogFirstMode: true });
    expect(await row("u2")).toBeNull();
  });

  it("an empty body {} changes nothing", async () => {
    expect((await put({})).status).toBe(200);
    expect(await row()).toMatchObject({ ...DEFAULTS, frogFirstMode: true, ...SPOTIFY });
  });
});

describe("PUT /api/user-settings: a frogFirstMode-only body", () => {
  it("leaves the timer fields untouched and the spotify tokens in place (not nulled)", async () => {
    await db.userSettings.create({ data: { userId: "u1", ...TIMER, frogFirstMode: false, ...SPOTIFY } });
    const before = await row();
    const res = await put({ frogFirstMode: true });
    expect(res.status).toBe(200);
    const after = await row();
    expect(after).toEqual({ ...before, frogFirstMode: true });
    expect(after).toMatchObject({ ...TIMER, ...SPOTIFY });
    expect(await res.json()).toMatchObject({ ...TIMER, frogFirstMode: true });
  });

  it("toggles back to false, and repeated PUTs are idempotent", async () => {
    await db.userSettings.create({ data: { userId: "u1", ...TIMER, ...SPOTIFY } });
    for (const v of [true, true, false, false, true, false]) {
      expect((await put({ frogFirstMode: v })).status).toBe(200);
      expect((await row()).frogFirstMode).toBe(v);
    }
    expect(await row()).toMatchObject({ ...TIMER, ...SPOTIFY, frogFirstMode: false });
    expect(await count()).toBe(1);
  });

  it("GET reflects the change", async () => {
    await put({ frogFirstMode: true });
    expect(((await (await GET()).json()) as Json).frogFirstMode).toBe(true);
    await put({ frogFirstMode: false });
    expect(((await (await GET()).json()) as Json).frogFirstMode).toBe(false);
  });

  it("changes frogFirstMode together with timer fields in one body", async () => {
    await db.userSettings.create({ data: { userId: "u1", frogFirstMode: false, ...SPOTIFY } });
    expect((await put({ ...POMODORO_BODY, frogFirstMode: true })).status).toBe(200);
    expect(await row()).toMatchObject({ ...POMODORO_BODY, frogFirstMode: true, ...SPOTIFY });
  });
});

describe("PUT /api/user-settings: 400s", () => {
  const SEED = { ...TIMER, frogFirstMode: true, ...SPOTIFY };

  it.each([
    ["the string 'true'", "true"],
    ["the string 'false'", "false"],
    ["the number 1", 1],
    ["the number 0", 0],
    ["null", null],
    ["an array", []],
    ["an array [true]", [true]],
    ["an object", {}],
    ["a string", ""],
    ["a float", 0.5],
  ])("frogFirstMode = %s -> 400 with an error message, row unchanged", async (_label, value) => {
    await db.userSettings.create({ data: { userId: "u1", ...SEED } });
    const before = await row();
    const res = await put({ frogFirstMode: value });
    expect(res.status).toBe(400);
    expect(typeof ((await res.json()) as Json).error).toBe("string");
    expect(await row()).toEqual(before);
  });

  it("a bad frogFirstMode next to valid timer fields rejects the whole body (timer fields not applied)", async () => {
    await db.userSettings.create({ data: { userId: "u1", ...SEED } });
    const before = await row();
    expect((await put({ focusMins: 99, frogFirstMode: "true" })).status).toBe(400);
    expect(await row()).toEqual(before);
  });

  it("a bad frogFirstMode with no row creates nothing", async () => {
    expect((await put({ frogFirstMode: 1 })).status).toBe(400);
    expect(await count()).toBe(0);
  });

  it.each([
    ["invalid JSON", "{nope"],
    ["empty body", ""],
    ["a truncated body", '{"frogFirstMode": tr'],
    ["the literal null", "null"],
  ])("%s -> 400, not 500, and nothing is written", async (_label, raw) => {
    await db.userSettings.create({ data: { userId: "u1", ...SEED } });
    const before = await row();
    const res = await putRaw(raw);
    expect(res.status).toBe(400);
    expect(typeof ((await res.json()) as Json).error).toBe("string");
    expect(await row()).toEqual(before);
  });

  it("invalid JSON with no row creates nothing", async () => {
    expect((await putRaw("{")).status).toBe(400);
    expect(await count()).toBe(0);
  });

  it.each([
    ["an array", "[]"],
    ["a number", "5"],
    ["a string", '"frogFirstMode"'],
    ["true", "true"],
  ])("a non-object JSON body (%s) is rejected with 400", async (_label, raw) => {
    const res = await putRaw(raw);
    expect(res.status).toBe(400);
  });
});

describe("two users: settings never cross", () => {
  beforeEach(async () => {
    await db.userSettings.create({ data: { userId: "u1", ...TIMER, frogFirstMode: false, ...SPOTIFY } });
    await db.userSettings.create({ data: { userId: "u2", focusMins: 11, shortMins: 2, longMins: 3, sessionsBeforeLong: 2, frogFirstMode: true, ...SPOTIFY_OTHER } });
  });

  it("u1's PUTs never modify u2's row (flag, timer fields, tokens)", async () => {
    const u2Before = await row("u2");
    await put({ frogFirstMode: true });
    await put({ ...POMODORO_BODY, userId: "u2" });
    await put({ frogFirstMode: false });
    expect(await row("u2")).toEqual(u2Before);
    expect(await row("u1")).toMatchObject({ ...POMODORO_BODY, frogFirstMode: false, ...SPOTIFY });
  });

  it("u2's PUT never modifies u1's row", async () => {
    signInAs("u2");
    const u1Before = await row("u1");
    await put({ frogFirstMode: false });
    expect(await row("u1")).toEqual(u1Before);
    expect((await row("u2")).frogFirstMode).toBe(false);
  });

  it("GET returns the caller's own flag and never the other user's values or tokens of the other user", async () => {
    const b1: Json = await (await GET()).json();
    expect(b1).toMatchObject({ userId: "u1", frogFirstMode: false, focusMins: 50 });
    expect(JSON.stringify(b1)).not.toContain("u2");
    signInAs("u2");
    const b2: Json = await (await GET()).json();
    expect(b2).toMatchObject({ userId: "u2", frogFirstMode: true, focusMins: 11 });
    expect(JSON.stringify(b2)).not.toContain("u1");
  });
});

describe("frogFirstMode in the Today payloads", () => {
  const BODY = (taskId: string) => ({ date: DATE, tz: TZ, taskIds: [taskId], ranks: {}, frogTaskId: taskId });
  let taskId: string;

  beforeEach(async () => {
    const { tasks } = await seedGroup("u1", { tasks: [{ title: "Frog", extra: { plannedFor: DATE } }] });
    taskId = tasks["Frog"].id;
  });

  it("GET /api/today: false with no settings row", async () => {
    const b: Json = await (await get()).json();
    expect(b.frogFirstMode).toBe(false);
    expect(await count()).toBe(0); // reading must not create a row
  });

  it("GET /api/today: true / false follows the user's row", async () => {
    await db.userSettings.create({ data: { userId: "u1", frogFirstMode: true } });
    expect(((await (await get()).json()) as Json).frogFirstMode).toBe(true);
    await db.userSettings.update({ where: { userId: "u1" }, data: { frogFirstMode: false } });
    expect(((await (await get()).json()) as Json).frogFirstMode).toBe(false);
  });

  it("GET /api/today: a PUT /api/user-settings is visible on the next GET", async () => {
    await put({ frogFirstMode: true });
    expect(((await (await get()).json()) as Json).frogFirstMode).toBe(true);
  });

  it("GET /api/today: another user's flag never leaks in either direction", async () => {
    await db.userSettings.create({ data: { userId: "u2", frogFirstMode: true } });
    expect(((await (await get()).json()) as Json).frogFirstMode).toBe(false);
    await db.userSettings.create({ data: { userId: "u1", frogFirstMode: false } });
    expect(((await (await get()).json()) as Json).frogFirstMode).toBe(false);
    signInAs("u2");
    expect(((await (await get()).json()) as Json).frogFirstMode).toBe(true);
  });

  it("PUT /api/today and POST /api/today/review responses carry it (true and false)", async () => {
    for (const flag of [true, false]) {
      await db.userSettings.upsert({ where: { userId: "u1" }, create: { userId: "u1", frogFirstMode: flag }, update: { frogFirstMode: flag } });
      const p: Json = await (await putToday(BODY(taskId))).json();
      expect(p.frogFirstMode).toBe(flag);
      const r = await postReview(
        new Request("http://localhost/api/today/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: DATE, tz: TZ, moves: [] }),
        }),
      );
      expect(r.status).toBe(200);
      expect(((await r.json()) as Json).frogFirstMode).toBe(flag);
    }
  });

  it("PUT /api/today and the review response say false with no settings row, and don't create one", async () => {
    expect(((await (await putToday(BODY(taskId))).json()) as Json).frogFirstMode).toBe(false);
    const r = await postReview(
      new Request("http://localhost/api/today/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: DATE, tz: TZ, moves: [] }) }),
    );
    expect(((await r.json()) as Json).frogFirstMode).toBe(false);
    expect(await count()).toBe(0);
  });

  it("saving or closing a day never changes the stored flag or the timer fields", async () => {
    await db.userSettings.create({ data: { userId: "u1", ...TIMER, frogFirstMode: true, ...SPOTIFY } });
    const before = await row();
    await putToday(BODY(taskId));
    await postReview(
      new Request("http://localhost/api/today/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: DATE, tz: TZ, moves: [] }) }),
    );
    expect(await row()).toEqual(before);
  });

  it("no token field of anyone ever appears in any Today response (two users, both with Spotify tokens)", async () => {
    await db.userSettings.create({ data: { userId: "u1", frogFirstMode: true, ...SPOTIFY } });
    await db.userSettings.create({ data: { userId: "u2", frogFirstMode: true, ...SPOTIFY_OTHER } });
    const bodies: string[] = [];
    bodies.push(JSON.stringify(await (await get()).json()));
    bodies.push(JSON.stringify(await (await putToday(BODY(taskId))).json()));
    const r = await postReview(
      new Request("http://localhost/api/today/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: DATE, tz: TZ, moves: [] }) }),
    );
    bodies.push(JSON.stringify(await r.json()));
    signInAs("u2");
    bodies.push(JSON.stringify(await (await get()).json()));
    for (const text of bodies) {
      expect(text).not.toMatch(/spotify/i);
      expect(text).not.toContain("TOKEN");
      expect(text).not.toContain("focusMins");
    }
  });

  it("buildTodayPayload reads a narrow select: only { frogFirstMode } is requested from UserSettings", async () => {
    await db.userSettings.create({ data: { userId: "u1", frogFirstMode: true, ...SPOTIFY } });
    const spy = vi.spyOn(db.userSettings, "findUnique");
    try {
      await get();
      const calls = spy.mock.calls.filter(() => true);
      expect(calls.length).toBe(1);
      expect(calls[0][0]).toEqual({ where: { userId: "u1" }, select: { frogFirstMode: true } });
    } finally {
      spy.mockRestore();
    }
  });
});
