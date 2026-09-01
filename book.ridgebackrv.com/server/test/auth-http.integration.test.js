import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequestHandler } from "../app.js";
import { loadConfig } from "../config.js";
import { createDatabasePool } from "../database.js";
import { MySqlAuthStore } from "../mysql-auth-store.js";

const runIntegration = process.env.RUN_MYSQL_INTEGRATION === "true";

function cookieFrom(response) {
  return String(response.headers.get("set-cookie") || "").split(";")[0];
}

test("registers, authenticates, resets, updates, and logs out through the HTTP API", { skip: !runIntegration }, async (context) => {
  const serverDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const projectRoot = resolve(serverDirectory, "..");
  const config = loadConfig(projectRoot);
  const pool = createDatabasePool(config.database);
  const authStore = new MySqlAuthStore(pool);
  const email = `auth-${randomUUID()}@ridgeback.invalid`;
  const firstPassword = "RidgebackStart2026";
  const secondPassword = "RidgebackReset2027";
  const handler = createRequestHandler({
    config,
    authStore,
    cloverClient: {},
    ledger: { async healthCheck() { return { connected: true, database: "test" }; } },
    staticRoot: projectRoot,
  });
  const server = createServer(handler);
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  context.after(() => new Promise((resolveClose) => server.close(resolveClose)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jsonHeaders = { "content-type": "application/json", origin: config.appOrigin };

  try {
    const registration = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ fullName: "Auth Integration Guest", email, password: firstPassword, confirmPassword: firstPassword, remember: true }),
    });
    assert.equal(registration.status, 201);
    const firstCookie = cookieFrom(registration);
    assert.match(firstCookie, /^ridgeback_session=/);

    const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: firstCookie } });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).user.email, email);

    const profile = await fetch(`${baseUrl}/api/account/profile`, {
      method: "PATCH",
      headers: { ...jsonHeaders, cookie: firstCookie },
      body: JSON.stringify({ fullName: "Updated Auth Guest", phone: "+1 713 555 0177", rvDetails: "34 ft fifth wheel" }),
    });
    assert.equal(profile.status, 200);
    assert.equal((await profile.json()).user.phone, "+1 713 555 0177");

    const forgot = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ email }),
    });
    assert.equal(forgot.status, 200);
    const resetUrl = (await forgot.json()).resetUrl;
    assert.ok(resetUrl);
    const resetToken = new URL(resetUrl).searchParams.get("token");

    const reset = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ token: resetToken, password: secondPassword, confirmPassword: secondPassword }),
    });
    assert.equal(reset.status, 200);
    const resetCookie = cookieFrom(reset);

    const expiredSession = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: firstCookie } });
    assert.equal((await expiredSession.json()).authenticated, false);
    const resetSession = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: resetCookie } });
    assert.equal((await resetSession.json()).authenticated, true);

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { ...jsonHeaders, cookie: resetCookie },
      body: "{}",
    });
    assert.equal(logout.status, 200);
    assert.match(String(logout.headers.get("set-cookie")), /Max-Age=0/);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ email, password: secondPassword }),
    });
    assert.equal(login.status, 200);
  } finally {
    await pool.execute("DELETE FROM users WHERE email = ?", [email]);
    await pool.end();
  }
});
