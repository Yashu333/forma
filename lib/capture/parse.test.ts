import { describe, expect, it } from "vitest";
import { parseCapture, nextWeekday } from "./parse";
import { formatRepeat } from "@/lib/recurrence/rule";

// 2026-10-24 is a Saturday; the 26th is the Monday after.
const TODAY = "2026-10-24";
const projects = [
  { id: "work", name: "Work" },
  { id: "side", name: "Side project" },
  { id: "personal", name: "Personal" },
  { id: "pers2", name: "Personal finance" },
];

const parse = (text: string, extra: Partial<Parameters<typeof parseCapture>[1]> = {}) =>
  parseCapture(text, { today: TODAY, nowTime: "08:00", projects, ...extra });

describe("parseCapture: the basics", () => {
  it("leaves plain text alone", () => {
    const r = parse("just a title");
    expect(r).toMatchObject({ title: "just a title", groupId: null, priority: null, due: null, planToday: false, repeat: null, tokens: [] });
  });

  it("pulls project, priority, date and time out of one line", () => {
    const r = parse("call dentist tmr 3pm #personal !high");
    expect(r.title).toBe("call dentist");
    expect(r.groupId).toBe("personal");
    expect(r.priority).toBe("HIGH");
    expect(r.due).toEqual({ date: "2026-10-25", time: "15:00" });
  });

  it("collapses the whitespace tokens leave behind", () => {
    expect(parse("a   tmr   b").title).toBe("a b");
  });

  it("a title made only of tokens is empty", () => {
    expect(parse("#work !low tomorrow").title).toBe("");
  });

  it("reports where each token was", () => {
    const r = parse("x tmr");
    expect(r.tokens).toEqual([{ start: 2, end: 5, kind: "date" }]);
  });
});

describe("parseCapture: dates", () => {
  const date = (text: string, today = TODAY) => parse(text, { today }).due?.date ?? null;

  it("today, tomorrow and their short forms", () => {
    expect(date("x today")).toBe("2026-10-24");
    expect(date("x tod")).toBe("2026-10-24");
    expect(date("x tomorrow")).toBe("2026-10-25");
    expect(date("x tmrw")).toBe("2026-10-25");
  });

  it("a weekday means the next one; the same weekday means next week", () => {
    expect(date("x mon")).toBe("2026-10-26");
    expect(date("x friday")).toBe("2026-10-30");
    expect(date("x sat")).toBe("2026-10-31");
    expect(date("x sun")).toBe("2026-10-25");
  });

  it("next week is the Monday after today", () => {
    expect(date("x next week")).toBe("2026-10-26");
    expect(date("x next week", "2026-10-26")).toBe("2026-11-02");
  });

  it("in N days and weeks", () => {
    expect(date("x in 3 days")).toBe("2026-10-27");
    expect(date("x in 1 day")).toBe("2026-10-25");
    expect(date("x in 2 weeks")).toBe("2026-11-07");
    expect(date("x in 0 days")).toBeNull();
  });

  it("month names, either order, with ordinals", () => {
    expect(date("x 30 oct")).toBe("2026-10-30");
    expect(date("x oct 30")).toBe("2026-10-30");
    expect(date("x 3rd november")).toBe("2026-11-03");
    expect(date("x dec 1st")).toBe("2026-12-01");
  });

  it("a date that has passed this year rolls to next year; today does not", () => {
    expect(date("x oct 5th")).toBe("2027-10-05");
    expect(date("x 24 oct")).toBe("2026-10-24");
    expect(date("x 23 oct")).toBe("2027-10-23");
  });

  it("day/month and ISO", () => {
    expect(date("x 5/11")).toBe("2026-11-05");
    expect(date("x 2026-12-31")).toBe("2026-12-31");
  });

  it("rejects dates that do not exist", () => {
    expect(date("x 31 nov")).toBeNull();
    expect(date("x 2026-02-30")).toBeNull();
    expect(date("x 32/1")).toBeNull();
  });

  it("Feb 29 waits for the next leap year", () => {
    expect(date("x 29 feb", "2027-03-01")).toBe("2028-02-29");
  });

  it("crosses the year boundary", () => {
    expect(date("x tomorrow", "2026-12-31")).toBe("2027-01-01");
    expect(date("x jan 2", "2026-12-31")).toBe("2027-01-02");
    expect(date("x in 2 weeks", "2026-12-25")).toBe("2027-01-08");
  });

  it("the last date wins and an earlier one stays in the title", () => {
    const r = parse("buy flowers mon for fri");
    expect(r.due?.date).toBe("2026-10-30");
    expect(r.title).toBe("buy flowers mon for");
  });

  it("does not read words that merely start like a date", () => {
    expect(parse("fix the monitor").due).toBeNull();
    expect(parse("sunset photos").due).toBeNull();
    expect(parse("todo list").due).toBeNull();
  });
});

describe("parseCapture: times", () => {
  const time = (text: string, extra = {}) => parse(text, extra).due?.time ?? null;

  it("am, pm, 24-hour and 'at'", () => {
    expect(time("x tmr 9am")).toBe("09:00");
    expect(time("x tmr 9:30pm")).toBe("21:30");
    expect(time("x tmr 15:45")).toBe("15:45");
    expect(time("x tmr at 9")).toBe("09:00");
    expect(time("x tmr at 5pm")).toBe("17:00");
  });

  it("noon and midnight", () => {
    expect(time("x tmr 12pm")).toBe("12:00");
    expect(time("x tmr 12am")).toBe("00:00");
  });

  it("rejects impossible times", () => {
    expect(parse("x tmr 25:00").due?.time ?? null).toBeNull();
    expect(parse("x tmr 13pm").due?.time ?? null).toBeNull();
    expect(parse("x tmr 9:75am").due?.time ?? null).toBeNull();
  });

  it("a time with no date is today, or tomorrow once it has passed", () => {
    expect(parse("x 9pm", { nowTime: "08:00" }).due).toEqual({ date: "2026-10-24", time: "21:00" });
    expect(parse("x 7am", { nowTime: "08:00" }).due).toEqual({ date: "2026-10-25", time: "07:00" });
    expect(parse("x 8am", { nowTime: "08:00" }).due).toEqual({ date: "2026-10-25", time: "08:00" });
  });

  it("without a clock reading a bare time stays today", () => {
    expect(parse("x 7am", { nowTime: undefined }).due).toEqual({ date: "2026-10-24", time: "07:00" });
  });
});

describe("parseCapture: project, priority, plan", () => {
  it("matches a project by prefix, ignoring case and spaces", () => {
    expect(parse("x #WORK").groupId).toBe("work");
    expect(parse("x #sidepro").groupId).toBe("side");
  });

  it("an exact match beats a longer prefix match, and the shortest prefix wins", () => {
    expect(parse("x #personal").groupId).toBe("personal");
    expect(parse("x #personalf").groupId).toBe("pers2");
    expect(parse("x #pers").groupId).toBe("personal");
  });

  it("an unknown project stays in the title", () => {
    const r = parse("x #nothing");
    expect(r.groupId).toBeNull();
    expect(r.title).toBe("x #nothing");
  });

  it("a # glued to a word is not a project", () => {
    expect(parse("email#work").groupId).toBeNull();
  });

  it("priority words and numbers", () => {
    expect(parse("x !urgent").priority).toBe("URGENT");
    expect(parse("x !LOW").priority).toBe("LOW");
    expect(parse("x !1").priority).toBe("URGENT");
    expect(parse("x !4").priority).toBe("LOW");
    expect(parse("x !5").priority).toBeNull();
    expect(parse("x !5").title).toBe("x !5");
  });

  it("@today plans the task for today", () => {
    const r = parse("x @today");
    expect(r.planToday).toBe(true);
    expect(r.title).toBe("x");
    expect(r.due).toBeNull(); // the @ keeps it from being read as a due date
  });

  it("dismissed tokens stay in the title and have no effect", () => {
    const r = parse("x tmr !high", { ignore: ["tmr", "!HIGH"] });
    expect(r.title).toBe("x tmr !high");
    expect(r.due).toBeNull();
    expect(r.priority).toBeNull();
  });
});

describe("parseCapture: repeats", () => {
  const rep = (text: string) => {
    const r = parse(text);
    return { label: r.repeat ? formatRepeat(r.repeat) : null, due: r.due, title: r.title };
  };

  it("every weekday and daily", () => {
    expect(rep("standup every weekday 9:30")).toEqual({ label: "Weekdays", due: { date: "2026-10-26", time: "09:30" }, title: "standup" });
    expect(rep("stretch daily").label).toBe("Every day");
    expect(rep("stretch every day").label).toBe("Every day");
  });

  it("a list of weekdays, and the first occurrence is the next of them", () => {
    const r = rep("gym every mon, wed, fri 7am");
    expect(r.label).toBe("Every Mon, Wed, Fri");
    expect(r.due).toEqual({ date: "2026-10-26", time: "07:00" });
    expect(r.title).toBe("gym");
  });

  it("every N units", () => {
    expect(rep("water plants every 3 days")).toMatchObject({ label: "Every 3 days", due: { date: "2026-10-24", time: null } });
    expect(rep("x every 2 weeks").label).toMatch(/^Every 2 weeks on /);
    expect(rep("x every 2 months").label).toMatch(/^Every 2 months on the /);
  });

  it("monthly on a day, and on the last day", () => {
    expect(rep("rent every month on the 1st")).toMatchObject({ label: "Every month on the 1st", due: { date: "2026-11-01", time: null } });
    expect(rep("backup every month on the last day")).toMatchObject({ label: "Every month on the last day", due: { date: "2026-10-31", time: null } });
  });

  it("yearly keeps an explicit date as its anchor", () => {
    expect(rep("taxes yearly 15 apr")).toMatchObject({ label: "Every year", due: { date: "2027-04-15", time: null } });
  });

  it("weekly with a date anchors on that date's weekday", () => {
    expect(rep("call mum weekly fri")).toMatchObject({ label: "Every Fri", due: { date: "2026-10-30", time: null } });
  });

  it("does not turn 'every mon' into a plain date", () => {
    const r = parse("x every mon");
    expect(r.tokens.filter((t) => t.kind === "date")).toHaveLength(0);
    expect(r.tokens.filter((t) => t.kind === "repeat")).toHaveLength(1);
  });

  it("a dismissed repeat is left in the title", () => {
    const r = parse("x daily", { ignore: ["daily"] });
    expect(r.repeat).toBeNull();
    expect(r.title).toBe("x daily");
  });
});

describe("nextWeekday", () => {
  it("is strictly after today", () => {
    expect(nextWeekday("2026-10-24", 6)).toBe("2026-10-31");
    expect(nextWeekday("2026-10-24", 0)).toBe("2026-10-25");
  });
});
