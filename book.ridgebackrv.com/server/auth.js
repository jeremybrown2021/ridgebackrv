import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SESSION_COOKIE = "ridgeback_session";

export class AuthError extends Error {
  constructor(status, code, message, fields = undefined) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function validateEmail(value) {
  const email = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

export function validateFullName(value) {
  const fullName = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return fullName.length >= 2 && fullName.length <= 120 ? fullName : null;
}

export function validatePassword(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    return "Use 8 to 128 characters.";
  }
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value)) {
    return "Include an uppercase letter, a lowercase letter, and a number.";
  }
  return null;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64url"), Buffer.from(key).toString("base64url")].join("$");
}

export async function verifyPassword(password, encodedHash) {
  const parts = String(encodedHash || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nValue, rValue, pValue, saltValue, keyValue] = parts;
  const n = Number(nValue);
  const r = Number(rValue);
  const p = Number(pValue);
  if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return false;
  let expected;
  let salt;
  try {
    expected = Buffer.from(keyValue, "base64url");
    salt = Buffer.from(saltValue, "base64url");
  } catch {
    return false;
  }
  if (expected.length !== SCRYPT_KEY_LENGTH || salt.length !== 16) return false;
  const actual = Buffer.from(await scrypt(password, salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: 64 * 1024 * 1024,
  }));
  return timingSafeEqual(actual, expected);
}

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token) {
  return createHash("sha256").update(String(token)).digest();
}

export function parseCookies(request) {
  const cookies = {};
  for (const part of String(request.headers.cookie || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

export function sessionTokenFromRequest(request) {
  return parseCookies(request)[SESSION_COOKIE] || "";
}

export function sessionCookie(token, { secure, maxAgeSeconds } = {}) {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) attributes.push("Secure");
  if (Number.isInteger(maxAgeSeconds) && maxAgeSeconds > 0) attributes.push(`Max-Age=${maxAgeSeconds}`);
  return attributes.join("; ");
}

export function clearSessionCookie({ secure } = {}) {
  return sessionCookie("", { secure }).replace(`${SESSION_COOKIE}=`, `${SESSION_COOKIE}=; Max-Age=0`);
}

export function publicUser(user) {
  return {
    id: String(user.id),
    email: user.email,
    fullName: user.full_name,
    phone: user.phone || "",
    rvDetails: user.rv_details || "",
  };
}

export { SESSION_COOKIE };
