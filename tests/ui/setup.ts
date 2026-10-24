// UI-project setup (see vitest.config.ts `setupFiles`): jest-dom matchers, an
// explicit DOM cleanup (vitest globals are off, so RTL can't auto-register it),
// and a guard that every test brings its own fetch stub.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// "Today" is read from the browser's zone; pin it so the tests don't depend on the machine.
process.env.TZ = "Europe/Berlin";

beforeEach(() => {
  // A test that forgets to stub fetch must fail loudly, not hit the network.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      throw new Error(`Unmocked fetch: ${String(input)}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
