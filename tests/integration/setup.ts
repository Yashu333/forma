// Integration-project setup file (see vitest.config.ts `setupFiles`).
//
// Registered here, not in a test file or helper, so the Supabase mock is in
// place before ANY test file imports a route handler, whatever its import order.
// It also resets the DB and the fake user before every test, so isolation does
// not depend on each test file remembering to opt in.
import { afterAll, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { fakeAuth } from "./fake-user";
import { resetDb } from "./helpers";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: fakeAuth.user }, error: null }),
    },
  }),
}));

beforeEach(async () => {
  fakeAuth.user = null;
  await resetDb();
});

afterAll(async () => {
  await db.$disconnect();
});
