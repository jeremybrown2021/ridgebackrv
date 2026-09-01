import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { isIP } from "node:net";
import { extname, resolve, sep } from "node:path";
import { calculatePrice, normalizeBooking, ValidationError } from "./pricing.js";
import { createQuoteToken, verifyQuoteToken } from "./quote.js";
import { CloverGatewayError } from "./clover-client.js";
import { PaymentConflictError } from "./payment-ledger.js";
import { AvailabilityError } from "./mysql-booking-store.js";
import {
  AuthError,
  clearSessionCookie,
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  publicUser,
  sessionCookie,
  sessionTokenFromRequest,
  validateEmail,
  validateFullName,
  validatePassword,
  verifyPassword,
} from "./auth.js";

const JSON_LIMIT_BYTES = 32 * 1024;
const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLOVER_TOKEN_PATTERN = /^clv_[A-Za-z0-9]+$/;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function securityHeaders(config) {
  const cloverHosts = "https://checkout.sandbox.dev.clover.com https://checkout.clover.com";
  const recaptchaHosts = "https://www.google.com https://www.gstatic.com";
  return {
    "content-security-policy": [
      "default-src 'self'",
      `script-src 'self' ${cloverHosts} ${recaptchaHosts}`,
      `frame-src ${cloverHosts} https://www.google.com`,
      `connect-src 'self' ${cloverHosts} ${recaptchaHosts} https://token-sandbox.dev.clover.com https://token.clover.com`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      `img-src 'self' data: ${cloverHosts}`,
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
    "cross-origin-opener-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(self)",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    ...(config.clover.environment === "production"
      ? { "strict-transport-security": "max-age=31536000; includeSubDomains" }
      : {}),
  };
}

function setHeaders(response, headers) {
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
}

function sendJson(response, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > JSON_LIMIT_BYTES) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    const error = new Error("Content-Type must be application/json.");
    error.status = 415;
    throw error;
  }
  const rawBody = await readBody(request);
  try {
    return { value: JSON.parse(rawBody.toString("utf8")), rawBody };
  } catch {
    const error = new Error("Request body must contain valid JSON.");
    error.status = 400;
    throw error;
  }
}

function normalizeGuest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError("Guest details are required.");
  }

  const fullName = typeof input.fullName === "string" ? input.fullName.trim().replace(/\s+/g, " ") : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";

  const fields = {};
  if (fullName.length < 2 || fullName.length > 120) fields.fullName = "Enter the guest's full name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fields.email = "Enter a valid email address.";
  if (!/^[+()\d\s.-]{7,30}$/.test(phone)) fields.phone = "Enter a valid phone number.";
  if (Object.keys(fields).length) throw new ValidationError("Review the guest details.", fields);

  return { fullName, email, phone };
}

function normalizeProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AuthError(400, "validation_error", "Profile details are required.");
  }
  const fullName = validateFullName(input.fullName);
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const rvDetails = typeof input.rvDetails === "string" ? input.rvDetails.trim().replace(/\s+/g, " ") : "";
  const fields = {};
  if (!fullName) fields.fullName = "Enter your full name.";
  if (phone && !/^[+()\d\s.-]{7,30}$/.test(phone)) fields.phone = "Enter a valid phone number.";
  if (rvDetails.length > 160) fields.rvDetails = "Keep RV details under 160 characters.";
  if (Object.keys(fields).length) throw new AuthError(400, "validation_error", "Review your profile details.", fields);
  return { fullName, phone, rvDetails };
}

function safeEqual(left, right) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function getClientIp(request, trustProxy) {
  let value = request.socket.remoteAddress || "";
  if (trustProxy && request.headers["x-forwarded-for"]) {
    value = String(request.headers["x-forwarded-for"]).split(",")[0].trim();
  }
  if (value.startsWith("::ffff:")) value = value.slice(7);
  const zoneIndex = value.indexOf("%");
  if (zoneIndex >= 0) value = value.slice(0, zoneIndex);
  return isIP(value) ? value : "127.0.0.1";
}

function createRateLimiter({ limit, windowMs }) {
  const attempts = new Map();
  return (key) => {
    const now = Date.now();
    const recent = (attempts.get(key) || []).filter((timestamp) => timestamp > now - windowMs);
    recent.push(now);
    attempts.set(key, recent);
    return recent.length <= limit;
  };
}

function assertSameOrigin(request, config) {
  const origin = request.headers.origin;
  if (origin && origin !== config.appOrigin) {
    const error = new Error("Cross-origin requests are not allowed.");
    error.status = 403;
    throw error;
  }
}

function publicPaymentConfig(config) {
  return {
    enabled: config.paymentsEnabled,
    provider: "clover",
    environment: config.clover.environment,
    merchantId: config.paymentsEnabled ? config.clover.merchantId : "",
    publicToken: config.paymentsEnabled ? config.clover.publicToken : "",
    sdkUrl: config.clover.sdkUrl,
  };
}

async function serveStatic(request, response, staticRoot, pathname, statusCode = 200) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return false;
  }

  let relativePath = decodedPath === "/" ? "/index.html" : decodedPath;
  if (relativePath.endsWith("/")) relativePath += "index.html";
  const filePath = resolve(staticRoot, `.${relativePath}`);
  if (filePath !== staticRoot && !filePath.startsWith(`${staticRoot}${sep}`)) return false;

  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch {
    return false;
  }
  if (!fileStats.isFile()) return false;

  response.writeHead(statusCode, {
    "cache-control": /[\\/](?:media)[\\/]/.test(filePath)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
    "content-length": fileStats.size,
    "content-type": MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream",
  });
  if (request.method === "HEAD") response.end();
  else createReadStream(filePath).pipe(response);
  return true;
}

export function createRequestHandler({ config, cloverClient, ledger, authStore = null, passwordResetMailer = null, staticRoot = config.projectRoot }) {
  const allowChargeAttempt = createRateLimiter({ limit: 6, windowMs: 5 * 60_000 });
  const allowLoginAttempt = createRateLimiter({ limit: 10, windowMs: 15 * 60_000 });
  const allowRegistrationAttempt = createRateLimiter({ limit: 8, windowMs: 60 * 60_000 });
  const allowResetAttempt = createRateLimiter({ limit: 5, windowMs: 30 * 60_000 });
  const headers = securityHeaders(config);
  const authConfig = {
    sessionHours: config.auth?.sessionHours || 12,
    rememberDays: config.auth?.rememberDays || 30,
    resetMinutes: config.auth?.resetMinutes || 30,
    secureCookies: config.auth?.secureCookies || false,
    exposeResetLinks: config.auth?.exposeResetLinks || false,
  };

  function requireAuthStore() {
    if (!authStore) throw new AuthError(503, "auth_unavailable", "Account services are temporarily unavailable.");
  }

  async function currentSession(request) {
    if (!authStore) return null;
    const token = sessionTokenFromRequest(request);
    if (!token) return null;
    const session = await authStore.findSession(hashOpaqueToken(token));
    return session ? { ...session, token } : null;
  }

  async function requireSession(request) {
    const session = await currentSession(request);
    if (!session) throw new AuthError(401, "authentication_required", "Sign in to continue.");
    return session;
  }

  async function issueSession({ user, request, remember }) {
    const token = createOpaqueToken();
    const lifetimeMs = remember
      ? authConfig.rememberDays * 24 * 60 * 60_000
      : authConfig.sessionHours * 60 * 60_000;
    await authStore.createSession({
      userId: user.id,
      tokenHash: hashOpaqueToken(token),
      persistent: remember,
      expiresAt: new Date(Date.now() + lifetimeMs),
      clientIp: getClientIp(request, config.trustProxy),
      userAgent: String(request.headers["user-agent"] || "").slice(0, 500),
    });
    return {
      token,
      cookie: sessionCookie(token, {
        secure: authConfig.secureCookies,
        maxAgeSeconds: remember ? Math.floor(lifetimeMs / 1000) : undefined,
      }),
    };
  }

  return async function requestHandler(request, response) {
    setHeaders(response, headers);
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        const database = typeof ledger.healthCheck === "function"
          ? await ledger.healthCheck()
          : { connected: true, database: "test" };
        return sendJson(response, 200, {
          ok: true,
          database,
          authEnabled: Boolean(authStore),
          paymentsEnabled: config.paymentsEnabled,
          cloverEnvironment: config.clover.environment,
        });
      }

      if (request.method === "GET" && url.pathname === "/api/auth/session") {
        const session = await currentSession(request);
        return sendJson(response, 200, session
          ? { authenticated: true, user: publicUser(session) }
          : { authenticated: false });
      }

      if (request.method === "POST" && url.pathname === "/api/auth/register") {
        requireAuthStore();
        assertSameOrigin(request, config);
        const clientIp = getClientIp(request, config.trustProxy);
        if (!allowRegistrationAttempt(clientIp)) {
          throw new AuthError(429, "rate_limited", "Too many account attempts. Wait before trying again.");
        }
        const { value } = await readJson(request);
        const email = validateEmail(value.email);
        const fullName = validateFullName(value.fullName);
        const passwordError = validatePassword(value.password);
        const fields = {};
        if (!fullName) fields.fullName = "Enter your full name.";
        if (!email) fields.email = "Enter a valid email address.";
        if (passwordError) fields.password = passwordError;
        if (value.password !== value.confirmPassword) fields.confirmPassword = "Passwords do not match.";
        if (Object.keys(fields).length) {
          throw new AuthError(400, "validation_error", "Review your account details.", fields);
        }
        const passwordHash = await hashPassword(value.password);
        const user = await authStore.createUser({ email, fullName, passwordHash });
        if (!user) {
          throw new AuthError(409, "email_in_use", "An account already exists for this email address.", {
            email: "Sign in or reset your password instead.",
          });
        }
        const issued = await issueSession({ user, request, remember: value.remember === true });
        await authStore.markLogin(user.id);
        return sendJson(response, 201, { authenticated: true, user: publicUser(user) }, {
          "set-cookie": issued.cookie,
        });
      }

      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        requireAuthStore();
        assertSameOrigin(request, config);
        const { value } = await readJson(request);
        const email = validateEmail(value.email) || "";
        const password = typeof value.password === "string" ? value.password : "";
        const clientIp = getClientIp(request, config.trustProxy);
        if (!allowLoginAttempt(`${clientIp}:${email}`)) {
          throw new AuthError(429, "rate_limited", "Too many sign-in attempts. Wait 15 minutes and try again.");
        }
        const user = email ? await authStore.findUserByEmail(email) : null;
        const passwordMatches = user && user.is_active === 1
          ? await verifyPassword(password, user.password_hash)
          : await hashPassword(password.slice(0, 128) || "invalid-password").then(() => false);
        if (!passwordMatches) {
          throw new AuthError(401, "invalid_credentials", "The email address or password is incorrect.");
        }
        const issued = await issueSession({ user, request, remember: value.remember === true });
        await authStore.markLogin(user.id);
        return sendJson(response, 200, { authenticated: true, user: publicUser(user) }, {
          "set-cookie": issued.cookie,
        });
      }

      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        assertSameOrigin(request, config);
        const token = sessionTokenFromRequest(request);
        if (authStore && token) await authStore.deleteSession(hashOpaqueToken(token));
        return sendJson(response, 200, { authenticated: false }, {
          "set-cookie": clearSessionCookie({ secure: authConfig.secureCookies }),
        });
      }

      if (request.method === "POST" && url.pathname === "/api/auth/forgot-password") {
        requireAuthStore();
        assertSameOrigin(request, config);
        const { value } = await readJson(request);
        const email = validateEmail(value.email);
        const clientIp = getClientIp(request, config.trustProxy);
        if (!allowResetAttempt(`${clientIp}:${email || "invalid"}`)) {
          throw new AuthError(429, "rate_limited", "Too many reset requests. Wait before trying again.");
        }
        let resetUrl;
        if (email) {
          const user = await authStore.findUserByEmail(email);
          if (user && user.is_active === 1) {
            const token = createOpaqueToken();
            await authStore.createPasswordReset({
              userId: user.id,
              tokenHash: hashOpaqueToken(token),
              expiresAt: new Date(Date.now() + authConfig.resetMinutes * 60_000),
              clientIp,
            });
            resetUrl = `${config.appOrigin}/reset-password/?token=${encodeURIComponent(token)}`;
            if (passwordResetMailer) {
              try {
                await passwordResetMailer.send({
                  email,
                  fullName: user.full_name,
                  resetUrl,
                  expiresInMinutes: authConfig.resetMinutes,
                });
              } catch (error) {
                console.error("Password reset email delivery failed", error);
              }
            } else if (authConfig.exposeResetLinks) {
              console.log(`Local password reset link for ${email}: ${resetUrl}`);
            }
          }
        }
        return sendJson(response, 200, {
          ok: true,
          message: "If that email belongs to an account, a password reset link is ready.",
          ...(authConfig.exposeResetLinks && resetUrl ? { resetUrl } : {}),
        });
      }

      if (request.method === "POST" && url.pathname === "/api/auth/reset-password") {
        requireAuthStore();
        assertSameOrigin(request, config);
        const { value } = await readJson(request);
        const token = typeof value.token === "string" ? value.token : "";
        const passwordError = validatePassword(value.password);
        const fields = {};
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fields.token = "This reset link is invalid or incomplete.";
        if (passwordError) fields.password = passwordError;
        if (value.password !== value.confirmPassword) fields.confirmPassword = "Passwords do not match.";
        if (Object.keys(fields).length) {
          throw new AuthError(400, "validation_error", "Review the new password.", fields);
        }
        const passwordHash = await hashPassword(value.password);
        const user = await authStore.consumePasswordReset({ tokenHash: hashOpaqueToken(token), passwordHash });
        if (!user) throw new AuthError(400, "invalid_reset_token", "This password reset link is invalid or has expired.");
        const issued = await issueSession({ user, request, remember: false });
        return sendJson(response, 200, { authenticated: true, user: publicUser(user) }, {
          "set-cookie": issued.cookie,
        });
      }

      if (request.method === "GET" && url.pathname === "/api/account/reservations") {
        requireAuthStore();
        const session = await requireSession(request);
        return sendJson(response, 200, { reservations: await authStore.listReservations(session.id) });
      }

      if (request.method === "PATCH" && url.pathname === "/api/account/profile") {
        requireAuthStore();
        assertSameOrigin(request, config);
        const session = await requireSession(request);
        const { value } = await readJson(request);
        const profile = normalizeProfile(value);
        const user = await authStore.updateProfile(session.id, profile);
        return sendJson(response, 200, { user: publicUser(user) });
      }

      if (request.method === "POST" && url.pathname === "/api/account/change-password") {
        requireAuthStore();
        assertSameOrigin(request, config);
        const session = await requireSession(request);
        const { value } = await readJson(request);
        const passwordError = validatePassword(value.newPassword);
        const fields = {};
        if (passwordError) fields.newPassword = passwordError;
        if (value.newPassword !== value.confirmPassword) fields.confirmPassword = "Passwords do not match.";
        if (Object.keys(fields).length) {
          throw new AuthError(400, "validation_error", "Review the new password.", fields);
        }
        const user = await authStore.findUserById(session.id);
        if (!user || !(await verifyPassword(String(value.currentPassword || ""), user.password_hash))) {
          throw new AuthError(401, "invalid_current_password", "Your current password is incorrect.", {
            currentPassword: "Enter your current password.",
          });
        }
        const passwordHash = await hashPassword(value.newPassword);
        await authStore.changePassword(user.id, passwordHash);
        const refreshedUser = await authStore.findUserById(user.id);
        const issued = await issueSession({ user: refreshedUser, request, remember: false });
        return sendJson(response, 200, { user: publicUser(refreshedUser) }, {
          "set-cookie": issued.cookie,
        });
      }

      if (request.method === "GET" && url.pathname === "/api/payments/clover/config") {
        return sendJson(response, 200, publicPaymentConfig(config));
      }

      if (request.method === "POST" && url.pathname === "/api/checkout/quote") {
        assertSameOrigin(request, config);
        if (!config.paymentsEnabled) {
          return sendJson(response, 503, { error: "payments_disabled", message: "Clover payments are not configured yet." });
        }
        const { value } = await readJson(request);
        const booking = normalizeBooking(value.booking);
        const pricing = typeof ledger.calculatePrice === "function"
          ? await ledger.calculatePrice(booking)
          : calculatePrice(booking);
        const quote = createQuoteToken({ booking, pricing, secret: config.clover.quoteSecret });
        if (typeof ledger.createQuote === "function") await ledger.createQuote(quote.payload);
        return sendJson(response, 200, {
          quoteToken: quote.token,
          expiresAt: quote.payload.expiresAt,
          pricing,
        });
      }

      if (request.method === "POST" && url.pathname === "/api/payments/clover/charge") {
        assertSameOrigin(request, config);
        if (!config.paymentsEnabled) {
          return sendJson(response, 503, { error: "payments_disabled", message: "Clover payments are not configured yet." });
        }

        const clientIp = getClientIp(request, config.trustProxy);
        if (!allowChargeAttempt(clientIp)) {
          return sendJson(response, 429, { error: "rate_limited", message: "Too many payment attempts. Wait a few minutes and try again." });
        }

        const idempotencyKey = String(request.headers["idempotency-key"] || "");
        if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
          return sendJson(response, 400, { error: "invalid_idempotency_key", message: "A UUID v4 Idempotency-Key header is required." });
        }

        const { value } = await readJson(request);
        if (!CLOVER_TOKEN_PATTERN.test(value.source || "") || value.source.length > 300) {
          return sendJson(response, 400, { error: "invalid_payment_token", message: "Clover returned an invalid card token." });
        }
        if (value.acceptedTerms !== true) {
          return sendJson(response, 400, { error: "terms_required", message: "Accept the reservation and cancellation terms before paying." });
        }
        const guest = normalizeGuest(value.guest);
        const quote = verifyQuoteToken(value.quoteToken, config.clover.quoteSecret);
        const authSession = await currentSession(request);

        if (typeof ledger.verifyQuote === "function") {
          await ledger.verifyQuote(quote);
        } else {
          const verifiedBooking = normalizeBooking(quote.booking, new Date(quote.issuedAt * 1000));
          const verifiedPricing = calculatePrice(verifiedBooking);
          if (JSON.stringify(verifiedPricing) !== JSON.stringify(quote.pricing)) {
            return sendJson(response, 400, { error: "invalid_quote", message: "The payment quote could not be verified." });
          }
        }

        const reservation = await ledger.reserve(quote.quoteId, idempotencyKey, {
          quote,
          guest,
          clientIp,
          userId: authSession?.id || null,
        });
        if (reservation.state === "succeeded") return sendJson(response, 200, reservation.record.result);
        if (reservation.state === "failed") {
          return sendJson(response, reservation.record.result.status, reservation.record.result.body);
        }

        try {
          const result = await cloverClient.createCharge({
            quote,
            source: value.source,
            guest,
            idempotencyKey,
            clientIp,
          });
          await ledger.complete(quote.quoteId, idempotencyKey, result);
          return sendJson(response, 200, result);
        } catch (error) {
          if (!(error instanceof CloverGatewayError)) throw error;
          const body = {
            error: error.code,
            message: error.message,
            retrySameAttempt: error.retryable,
          };
          if (error.retryable && typeof ledger.markUnknown === "function") {
            await ledger.markUnknown(quote.quoteId, idempotencyKey, error);
          } else if (!error.retryable) {
            await ledger.fail(quote.quoteId, idempotencyKey, { status: error.status, body });
          }
          return sendJson(response, error.status, body);
        }
      }

      if (request.method === "POST" && url.pathname === "/api/webhooks/clover") {
        const { value, rawBody } = await readJson(request);
        if (value.verificationCode) return sendJson(response, 200, { received: true });
        if (!config.clover.webhookAuthCode) {
          return sendJson(response, 503, { error: "webhook_not_configured" });
        }
        if (!safeEqual(String(request.headers["x-clover-auth"] || ""), config.clover.webhookAuthCode)) {
          return sendJson(response, 401, { error: "invalid_webhook_auth" });
        }
        if (typeof ledger.recordWebhook === "function") await ledger.recordWebhook(value, rawBody);
        response.writeHead(204);
        return response.end();
      }

      if (url.pathname.startsWith("/api/")) {
        return sendJson(response, 404, { error: "not_found" });
      }

      if (await serveStatic(request, response, staticRoot, url.pathname)) return;
      if (await serveStatic(request, response, staticRoot, "/404.html", 404)) return;
      return sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof ValidationError) {
        return sendJson(response, 400, { error: "validation_error", message: error.message, fields: error.fields });
      }
      if (error instanceof PaymentConflictError) {
        return sendJson(response, 409, { error: "payment_conflict", message: error.message });
      }
      if (error instanceof AvailabilityError) {
        return sendJson(response, 409, { error: "inventory_unavailable", message: error.message });
      }
      if (error instanceof AuthError) {
        return sendJson(response, error.status, {
          error: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
        });
      }
      if (error.message === "Invalid quote token." || error.message.toLowerCase().includes("quote has expired")) {
        return sendJson(response, 400, { error: "invalid_quote", message: error.message });
      }
      if (error.status) return sendJson(response, error.status, { error: "bad_request", message: error.message });
      console.error("Unhandled request error", error);
      return sendJson(response, 500, { error: "internal_error", message: "The request could not be completed." });
    }
  };
}

export { getClientIp, normalizeGuest };
