// The fetch calls the habits UI makes. Each throws an Error carrying the
// server's `{ error }` message so the UI can show it.

export interface HabitDTO {
  id: string;
  name: string;
  weekdays: number[]; // 0 = Sunday
  order: number;
  createdKey: string;
  checks: string[]; // ticked date keys, from the start of the 5-week grid
  streak: { current: number; longest: number };
  rate: { scheduled: number; done: number };
  scheduledToday: boolean;
}

export interface ArchivedHabit {
  id: string;
  name: string;
  weekdays: number[];
}

export interface HabitsPayload {
  habits: HabitDTO[];
  archived: ArchivedHabit[];
}

async function check(res: Response, fallback: string): Promise<Response> {
  if (!res.ok) {
    let message = fallback;
    try {
      const body = await res.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {
      // not JSON: keep the fallback
    }
    throw new Error(message);
  }
  return res;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export async function fetchHabits(today: string, tz: string): Promise<HabitsPayload> {
  const qs = new URLSearchParams({ today, tz });
  return (await check(await fetch(`/api/habits?${qs}`), "Couldn't load your habits")).json();
}

export async function createHabit(name: string, weekdays: number[]): Promise<void> {
  await check(await fetch("/api/habits", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ name, weekdays }) }), "Couldn't add the habit");
}

export async function patchHabit(id: string, body: { name?: string; weekdays?: number[]; order?: number; archived?: boolean }): Promise<void> {
  await check(await fetch(`/api/habits/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) }), "Couldn't save the habit");
}

export async function deleteHabit(id: string): Promise<void> {
  await check(await fetch(`/api/habits/${id}`, { method: "DELETE" }), "Couldn't delete the habit");
}

export async function setCheck(id: string, date: string, on: boolean, today: string): Promise<void> {
  const qs = new URLSearchParams({ today });
  await check(await fetch(`/api/habits/${id}/checks/${date}?${qs}`, { method: on ? "PUT" : "DELETE" }), "Couldn't save that tick");
}
