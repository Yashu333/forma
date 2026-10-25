#!/usr/bin/env node
// Mobile check harness (docs/mobile-pwa/SPEC.md, P0).
//
//   npm run test:mobile                       # build, seed, check every page at both viewports
//   npm run test:mobile -- --only group       # one page (comma-separate for several)
//   npm run test:mobile -- --skip-build       # reuse the last harness build in .next
//
// What it does:
// 1. seeds the harness user's data into the local `forma_test` DB
//    (run `bash scripts/test-db.sh` first);
// 2. starts a mock Supabase Auth server on 127.0.0.1:54399 (scripts/mobile-check/mock-auth.mjs);
// 3. runs `next build` with NEXT_PUBLIC_SUPABASE_URL pointing at the mock.
//    NEXT_PUBLIC_* values are inlined at build time, so this is a normal build
//    into `.next` (Next has no dist-dir override outside next.config.ts). It
//    writes `.next/mobile-check-build.json`; `--skip-build` reuses the build
//    only when that marker matches, and rebuilds otherwise (for example after
//    the Gate's own `next build` with a different Supabase URL);
// 4. `next start` on the first free port from 3100;
// 5. Playwright Chromium at 390x844 (iPhone 14 UA, DPR 3) and 360x740 (Galaxy S8
//    UA, DPR 3), both isMobile + hasTouch, with the session cookie set so app
//    pages render signed in;
// 6. per page: no horizontal overflow (scrollWidth <= innerWidth + 1 on the
//    document and on <main>) = pass/fail; interactive elements under 32x32 CSS
//    px = warnings; screenshot to .mobile-shots/<viewport>/<page>.png.
//
// Exit code: 0 every check passed, 1 a page overflowed or failed to render,
// 2 the harness itself couldn't run. Full details: .mobile-shots/report.json.
import { execSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MOCK_ANON_KEY, MOCK_SUPABASE_URL, TEST_USER, sessionCookies, startMockAuth } from "./mobile-check/mock-auth.mjs";
import { TEST_DB_URL, seed } from "./mobile-check/seed.mjs";
import { pageList } from "./mobile-check/pages.mjs";
import { checkOverflow, recordOverflow, smallTargets } from "./mobile-check/inspect.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = path.join(ROOT, ".mobile-shots");
const DIST = path.join(ROOT, ".next");
const MARKER = path.join(DIST, "mobile-check-build.json");
const NEXT_BIN = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const TIME_ZONE = "UTC"; // browser zone; the seed's "today" uses the same one
const MIN_TARGET = 32;

const VIEWPORTS = [
  { name: "390x844", device: "iPhone 14", width: 390, height: 844 },
  { name: "360x740", device: "Galaxy S8", width: 360, height: 740 },
];

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { only: null, skipBuild: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only") opts.only = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith("--only=")) opts.only = a.slice(7).split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--skip-build") opts.skipBuild = true;
    else if (a === "--verbose" || a === "-v") opts.verbose = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (opts.only && opts.only.length === 0) throw new Error("--only needs a page name");
  return opts;
}

const HELP = `Usage: node scripts/mobile-check.mjs [--only <page>[,<page>...]] [--skip-build] [--verbose]

  --only <page>   check only these pages (names below)
  --skip-build    reuse the last harness build in .next (rebuilds if it was built for another Supabase URL)
  --verbose       print every small tap target and every mock-auth request

Pages: ${pageList({ groupId: "<id>", taskId: "<id>" }).map((p) => p.key).join(", ")}`;

// ── Helpers ─────────────────────────────────────────────────────────────────

function loadPlaywright() {
  const bases = [import.meta.url, path.join(process.cwd(), "noop.js")];
  for (const base of bases) {
    try {
      return createRequire(base)("playwright");
    } catch {
      // try the next one
    }
  }
  try {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    return createRequire(path.join(globalRoot, "noop.js"))("playwright");
  } catch {
    throw new Error("can't load the preinstalled Playwright (require('playwright') failed)");
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

async function freePort(start) {
  for (let p = start; p < start + 100; p++) if (await portFree(p)) return p;
  throw new Error(`no free port in ${start}-${start + 99}`);
}

function appEnv() {
  return {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: MOCK_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: MOCK_ANON_KEY,
    DATABASE_URL: TEST_DB_URL,
    DIRECT_URL: TEST_DB_URL,
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

function buildIsReusable() {
  try {
    const marker = JSON.parse(fs.readFileSync(MARKER, "utf8"));
    const buildId = fs.readFileSync(path.join(DIST, "BUILD_ID"), "utf8").trim();
    if (marker.buildId !== buildId) return "the build in .next was replaced since the harness built it";
    if (marker.supabaseUrl !== MOCK_SUPABASE_URL) return `it was built for ${marker.supabaseUrl}`;
    return null;
  } catch {
    return "no harness build found in .next";
  }
}

function run(cmd, args, { env, logFile }) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(logFile);
    const child = spawn(cmd, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    child.on("error", reject);
    child.on("close", (code) => {
      out.end();
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(cmd)} ${args.join(" ")} exited with ${code}; see ${path.relative(ROOT, logFile)}`));
    });
  });
}

async function build() {
  const t0 = Date.now();
  const logFile = path.join(SHOTS, "build.log");
  console.log(`→ next build (NEXT_PUBLIC_SUPABASE_URL=${MOCK_SUPABASE_URL}) … log: ${path.relative(ROOT, logFile)}`);
  try {
    await run(process.execPath, [NEXT_BIN, "build"], { env: appEnv(), logFile });
  } catch (err) {
    const log = fs.readFileSync(logFile, "utf8").split("\n").slice(-40).join("\n");
    throw new Error(`${err.message}\n${log}`);
  }
  const buildId = fs.readFileSync(path.join(DIST, "BUILD_ID"), "utf8").trim();
  fs.writeFileSync(MARKER, JSON.stringify({ buildId, supabaseUrl: MOCK_SUPABASE_URL, builtAt: new Date().toISOString() }, null, 2));
  console.log(`  built in ${Math.round((Date.now() - t0) / 1000)}s`);
}

async function startServer(port) {
  const logFile = path.join(SHOTS, "server.log");
  const out = fs.createWriteStream(logFile);
  const child = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: ROOT,
    env: appEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  let exited = null;
  child.on("exit", (code) => (exited = code));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`next start exited with ${exited}; see ${path.relative(ROOT, logFile)}`);
    try {
      const res = await fetch(`${base}/login`, { redirect: "manual" });
      if (res.status < 500) return { child, base, logFile };
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  stopServer(child);
  throw new Error(`next start didn't answer on ${base} within 60s; see ${path.relative(ROOT, logFile)}`);
}

function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

// ── One check ───────────────────────────────────────────────────────────────

async function checkPage(context, base, vp, spec, verbose) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e.message).split("\n")[0]}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().split("\n")[0].slice(0, 200)}`);
  });

  const result = { page: spec.key, viewport: vp.name, path: spec.path, status: "pass", errors };
  try {
    const res = await page.goto(base + spec.path, { waitUntil: "load", timeout: 45_000 });
    result.httpStatus = res ? res.status() : null;
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready).catch(() => {});

    const finalPath = new URL(page.url()).pathname;
    const wanted = new URL(base + spec.path).pathname;
    if (finalPath !== wanted) {
      result.status = "error";
      result.reason = `redirected to ${finalPath}${finalPath === "/login" ? " (not signed in)" : ""}`;
    } else if (result.httpStatus && result.httpStatus >= 400) {
      result.status = "error";
      result.reason = `HTTP ${result.httpStatus}`;
    }

    if (result.status === "pass" && spec.open) {
      try {
        await spec.open(page);
        await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
      } catch (err) {
        result.status = "error";
        result.reason = `couldn't open state: ${String(err.message).split("\n")[0]}`;
      }
    }
    await page.waitForTimeout(400); // let transitions and late layout settle

    const ov = await page.evaluate(checkOverflow, vp.width);
    result.overflow = ov;
    result.smallTargets = await page.evaluate(smallTargets, { min: MIN_TARGET, viewportWidth: vp.width, viewportHeight: vp.height });
    if (result.status === "pass" && ov.overflow) result.status = "fail";

    const dir = path.join(SHOTS, vp.name);
    fs.mkdirSync(dir, { recursive: true });
    result.screenshot = path.relative(ROOT, path.join(dir, `${spec.key}.png`));
    await page.screenshot({ path: path.join(dir, `${spec.key}.png`), fullPage: true });
  } catch (err) {
    result.status = "error";
    result.reason = String(err.message).split("\n")[0];
  } finally {
    await page.close().catch(() => {});
  }

  if (verbose && result.smallTargets?.length) {
    for (const t of result.smallTargets) console.log(`    small target ${vp.name} ${spec.key}: <${t.tag}> "${t.label}" ${t.width}x${t.height}`);
  }
  return result;
}

// ── Report ──────────────────────────────────────────────────────────────────

function cell(r) {
  if (!r) return "-";
  const warn = r.smallTargets?.length ? ` (${r.smallTargets.length} small)` : "";
  if (r.status === "pass") return `pass${warn}`;
  if (r.status === "fail") {
    const by = Math.max(r.overflow.docScrollWidth, r.overflow.mainScrollWidth ?? 0) - r.overflow.viewportWidth;
    return `FAIL +${by}px${warn}`;
  }
  return "ERROR";
}

function printTable(results, keys) {
  const head = ["Page", ...VIEWPORTS.map((v) => v.name)];
  const rows = keys.map((k) => [k, ...VIEWPORTS.map((v) => cell(results.find((r) => r.page === k && r.viewport === v.name)))]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cols) => "| " + cols.map((c, i) => c.padEnd(widths[i])).join(" | ") + " |";
  console.log(line(head));
  console.log("|" + widths.map((w) => "-".repeat(w + 2)).join("|") + "|");
  for (const r of rows) console.log(line(r));
}

function describeEl(o) {
  const cls = o.classes ? `.${o.classes.split(" ").join(".")}` : "";
  return `<${o.tag}${o.id ? `#${o.id}` : ""}> ${cls ? cls + " " : ""}width ${o.width}px, right edge ${o.right}px${o.overflowBy > 0 ? ` (+${o.overflowBy}px)` : ""}${o.text ? ` "${o.text}"` : ""}${o.note ? ` [${o.note}]` : ""}`;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  fs.mkdirSync(SHOTS, { recursive: true });

  const { chromium, devices } = loadPlaywright();

  console.log(`→ seeding forma_test for ${TEST_USER.email} (${TEST_USER.id})`);
  const ids = await seed({ userId: TEST_USER.id, timeZone: TIME_ZONE });
  const pages = pageList(ids);
  const keys = opts.only ?? pages.map((p) => p.key);
  const unknownKeys = keys.filter((k) => !pages.some((p) => p.key === k));
  if (unknownKeys.length) throw new Error(`unknown page(s): ${unknownKeys.join(", ")}. Pages: ${pages.map((p) => p.key).join(", ")}`);

  const authLog = [];
  const mock = await startMockAuth({
    log: (l) => {
      authLog.push(l);
      if (opts.verbose) console.log("  " + l);
    },
  });
  console.log(`→ mock Supabase auth on ${MOCK_SUPABASE_URL}`);

  let server = null;
  let browser = null;
  try {
    if (opts.skipBuild) {
      const why = buildIsReusable();
      if (why) {
        console.log(`→ --skip-build: can't reuse .next (${why}); building`);
        await build();
      } else console.log("→ --skip-build: reusing the harness build in .next");
    } else {
      await build();
    }

    const port = await freePort(3100);
    server = await startServer(port);
    console.log(`→ next start on ${server.base} (log: ${path.relative(ROOT, server.logFile)})`);

    browser = await chromium.launch();
    const results = [];
    for (const vp of VIEWPORTS) {
      const d = devices[vp.device] ?? {};
      const ctxOpts = {
        userAgent: d.userAgent,
        viewport: { width: vp.width, height: vp.height },
        screen: { width: vp.width, height: vp.height },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        timezoneId: TIME_ZONE,
        locale: "en-US",
      };
      const signedIn = await browser.newContext(ctxOpts);
      await signedIn.addCookies(sessionCookies(server.base));
      const signedOut = await browser.newContext(ctxOpts);
      for (const ctx of [signedIn, signedOut]) {
        // Belt and braces: nothing may reach a real Supabase project.
        await ctx.route(/^https?:\/\/[^/]*supabase\.(co|com|in)\//, (route) => route.abort());
        await ctx.addInitScript(recordOverflow, vp.width);
      }

      for (const key of keys) {
        const spec = pages.find((p) => p.key === key);
        const r = await checkPage(spec.auth === false ? signedOut : signedIn, server.base, vp, spec, opts.verbose);
        results.push(r);
        console.log(`  ${vp.name} ${key.padEnd(16)} ${cell(r)}${r.reason ? ` — ${r.reason}` : ""}`);
      }
      await signedIn.close();
      await signedOut.close();
    }

    // ── Summary ──
    console.log("\nMobile check results (pass/fail = horizontal overflow; small = interactive elements under 32x32 px, warnings)\n");
    printTable(results, keys);

    const failing = results.filter((r) => r.status === "fail");
    if (failing.length) {
      console.log("\nOverflow, worst offending element:");
      for (const r of failing) {
        const o = r.overflow;
        const worst = o.offenders[0];
        const lines = [`  ${r.viewport} ${r.page}: document ${o.docScrollWidth}px, main ${o.mainScrollWidth ?? "-"}px, viewport ${o.viewportWidth}px`];
        if (worst && !worst.note) lines.push(`    ${describeEl(worst)}`);
        else if (o.duringLoad) {
          // The page grew past the edge while loading and the phone stayed zoomed out.
          const l = o.duringLoad;
          lines.push(`    while loading (${l.atMs}ms, document ${l.docScrollWidth}px): ${describeEl(l)}`);
          if (l.style) lines.push(`      style="${l.style}"`);
          if (l.parents) lines.push(`      inside ${l.parents}`);
          lines.push("      (nothing sticks out at check time; the page stayed zoomed out)");
        } else if (worst) lines.push(`    ${describeEl(worst)}`);
        else lines.push("    (nothing sticks out now, and the page overflowed before the first frame the harness records; see the screenshot or the other viewport)");
        console.log(lines.join("\n"));
      }
    }
    const scrollers = results.filter((r) => r.overflow?.sideScrollers?.length);
    if (scrollers.length) {
      console.log("\nScrolls sideways inside the page (info, not a failure; intentional on the board):");
      for (const r of scrollers) {
        for (const s of r.overflow.sideScrollers.slice(0, 3)) {
          console.log(`  ${r.viewport} ${r.page}: ${describeEl(s)}, content ${s.scrollWidth}px in ${s.clientWidth}px`);
        }
      }
    }
    const errored = results.filter((r) => r.status === "error");
    if (errored.length) {
      console.log("\nCouldn't check:");
      for (const r of errored) console.log(`  ${r.viewport} ${r.page}: ${r.reason}`);
    }
    const unknown = [...mock.unknown.entries()];
    console.log(
      `\nMock auth: ${mock.stats.userOk} GET /auth/v1/user answered, ${mock.stats.userDenied} denied, ` +
        (unknown.length ? `other requests: ${unknown.map(([k, n]) => `${k} x${n}`).join(", ")}` : "no other requests")
    );

    const report = {
      generatedAt: new Date().toISOString(),
      supabaseUrl: MOCK_SUPABASE_URL,
      user: TEST_USER,
      seeded: ids,
      viewports: VIEWPORTS,
      mockAuth: { ...mock.stats, unknown: Object.fromEntries(mock.unknown), log: authLog },
      results,
    };
    fs.writeFileSync(path.join(SHOTS, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Screenshots: .mobile-shots/<viewport>/<page>.png   Report: .mobile-shots/report.json`);

    const passed = results.filter((r) => r.status === "pass").length;
    console.log(`\n${passed}/${results.length} checks passed, ${failing.length} overflow, ${errored.length} couldn't render`);
    return failing.length || errored.length ? 1 : 0;
  } finally {
    if (browser) await browser.close().catch(() => {});
    stopServer(server?.child);
    mock.server.closeAllConnections();
    await new Promise((r) => mock.server.close(r));
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`mobile-check: ${err.message}`);
    process.exit(2);
  }
);
