import assert from "node:assert/strict";
import test from "node:test";
import {
  clearSessionCookie,
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  sessionCookie,
  validatePassword,
  verifyPassword,
} from "../auth.js";

test("hashes passwords with scrypt and verifies without storing plaintext", async () => {
  const password = "RidgebackAuth2026";
  const encoded = await hashPassword(password);
  assert.match(encoded, /^scrypt\$16384\$8\$1\$/);
  assert.equal(encoded.includes(password), false);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword("WrongPassword2026", encoded), false);
});

test("enforces the account password policy", () => {
  assert.match(validatePassword("short"), /8 to 128/i);
  assert.match(validatePassword("alllowercase123"), /uppercase/i);
  assert.equal(validatePassword("Good123A"), null);
  assert.equal(validatePassword("StrongPassword123"), null);
});

test("creates opaque tokens, fixed-length token hashes, and hardened cookies", () => {
  const token = createOpaqueToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(hashOpaqueToken(token).length, 32);
  assert.match(sessionCookie(token, { secure: true, maxAgeSeconds: 3600 }), /HttpOnly; SameSite=Lax; Secure; Max-Age=3600/);
  assert.match(clearSessionCookie({ secure: true }), /Max-Age=0/);
});
