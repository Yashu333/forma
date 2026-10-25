// A tiny stand-in for the Supabase Auth API (GoTrue), for the mobile harness.
//
// The app builds with NEXT_PUBLIC_SUPABASE_URL pointing here, so every
// `supabase.auth.getUser()` (proxy.ts, the (app) layout, pages, API routes)
// lands on this server instead of real Supabase. It knows one fixed user and
// one fixed access token; anything it doesn't recognise is logged so a new
// call made on page load is easy to spot.
//
// Cookie format, from @supabase/ssr 0.10 and @supabase/supabase-js 2.105:
// - name: `sb-<first label of the URL hostname>-auth-token`
//   (supabase-js: `sb-${new URL(url).hostname.split(".")[0]}-auth-token`),
//   so http://127.0.0.1:<port> gives `sb-127-auth-token`;
// - value: "base64-" + base64url(JSON.stringify(session))
//   (createServerClient/createBrowserClient default cookieEncoding "base64url");
// - values whose encodeURIComponent() is longer than 3180 chars are split into
//   `<name>.0`, `<name>.1`, ... (ssr utils/chunker.js MAX_CHUNK_SIZE);
// - auth-js accepts a stored session that has access_token, refresh_token and
//   expires_at; when expires_at is more than the expiry margin in the future
//   it does not try to refresh, and getUser() calls GET /auth/v1/user with
//   `Authorization: Bearer <access_token>`.
import http from "node:http";
import crypto from "node:crypto";

export const MOCK_AUTH_HOST = "127.0.0.1";
export const MOCK_AUTH_PORT = Number(process.env.MOBILE_CHECK_AUTH_PORT ?? 54399);
export const MOCK_SUPABASE_URL = `http://${MOCK_AUTH_HOST}:${MOCK_AUTH_PORT}`;
export const MOCK_ANON_KEY = "mobile-check-anon-key";

export const TEST_USER = {
  id: "00000000-0000-4000-8000-00000000f0a1",
  email: "phone@forma.test",
};

const ACCESS_TOKEN = makeJwt();
const REFRESH_TOKEN = "mobile-check-refresh-token";
const MAX_CHUNK_SIZE = 3180;

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function makeJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      sub: TEST_USER.id,
      email: TEST_USER.email,
      aud: "authenticated",
      role: "authenticated",
      iat: now,
      exp: now + 365 * 24 * 3600,
      session_id: "00000000-0000-4000-8000-0000000005e5",
      is_anonymous: false,
    })
  );
  // Nobody verifies this signature: the app asks this server who the token belongs to.
  const sig = crypto.createHmac("sha256", "mobile-check-not-a-secret").update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function userJson() {
  const created = "2026-01-01T00:00:00.000Z";
  return {
    id: TEST_USER.id,
    aud: "authenticated",
    role: "authenticated",
    email: TEST_USER.email,
    email_confirmed_at: created,
    phone: "",
    confirmed_at: created,
    last_sign_in_at: created,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: created,
    updated_at: created,
    is_anonymous: false,
  };
}

function sessionJson() {
  const expiresIn = 365 * 24 * 3600;
  return {
    access_token: ACCESS_TOKEN,
    token_type: "bearer",
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    refresh_token: REFRESH_TOKEN,
    user: userJson(),
  };
}

/** The `sb-<ref>-auth-token` cookie(s) that make the app see TEST_USER as signed in. */
export function sessionCookies(appUrl) {
  const ref = new URL(MOCK_SUPABASE_URL).hostname.split(".")[0];
  const name = `sb-${ref}-auth-token`;
  const value = "base64-" + b64url(JSON.stringify(sessionJson()));
  const chunks = [];
  if (encodeURIComponent(value).length <= MAX_CHUNK_SIZE) {
    chunks.push({ name, value });
  } else {
    // base64url is URL-safe, so a plain slice matches the chunker's output.
    for (let i = 0, n = 0; i < value.length; i += MAX_CHUNK_SIZE, n++) {
      chunks.push({ name: `${name}.${n}`, value: value.slice(i, i + MAX_CHUNK_SIZE) });
    }
  }
  return chunks.map((c) => ({ ...c, url: appUrl, sameSite: "Lax", httpOnly: false }));
}

/**
 * Starts the mock. `log(line)` receives one line per request that isn't the
 * expected `GET /auth/v1/user`. Resolves to { server, stats, unknown }.
 */
export function startMockAuth({ log = () => {} } = {}) {
  const stats = { userOk: 0, userDenied: 0, other: 0 };
  const unknown = new Map(); // "METHOD path" -> count

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", MOCK_SUPABASE_URL);
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const send = (status, body) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        // The browser client (Sidebar) may call us cross-origin.
        "Access-Control-Allow-Origin": req.headers.origin ?? "*",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": req.headers["access-control-request-headers"] ?? "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    const note = (status) => {
      stats.other++;
      const key = `${req.method} ${url.pathname}`;
      unknown.set(key, (unknown.get(key) ?? 0) + 1);
      log(`[mock-auth] ${req.method} ${url.pathname}${url.search} -> ${status}`);
    };

    // Drain the body (POSTs) before answering.
    req.on("data", () => {});
    req.on("end", () => {
      if (req.method === "OPTIONS") return send(204);

      if (req.method === "GET" && url.pathname === "/auth/v1/user") {
        if (bearer === ACCESS_TOKEN) {
          stats.userOk++;
          return send(200, userJson());
        }
        stats.userDenied++;
        return send(403, { code: 403, error_code: "bad_jwt", msg: "invalid JWT" });
      }

      if (req.method === "POST" && url.pathname === "/auth/v1/token") {
        // Refresh: shouldn't happen (expires_at is a year away), but answer sanely.
        note(200);
        return send(200, sessionJson());
      }

      if (req.method === "POST" && url.pathname === "/auth/v1/logout") {
        note(204);
        return send(204);
      }

      note(404);
      return send(404, { code: 404, error_code: "not_found", msg: `mock auth: no handler for ${req.method} ${url.pathname}` });
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `mock auth: port ${MOCK_AUTH_PORT} is in use. It is baked into the build (NEXT_PUBLIC_SUPABASE_URL), ` +
              `so free it, or set MOBILE_CHECK_AUTH_PORT and rebuild.`
          )
        );
      } else reject(err);
    });
    server.listen(MOCK_AUTH_PORT, MOCK_AUTH_HOST, () => resolve({ server, stats, unknown }));
  });
}
