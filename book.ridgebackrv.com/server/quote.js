import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const QUOTE_VERSION = 1;
const QUOTE_TTL_SECONDS = 15 * 60;

function sign(encodedPayload, secret) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function createQuoteToken({ booking, pricing, secret, now = Date.now() }) {
  const payload = {
    version: QUOTE_VERSION,
    quoteId: randomBytes(12).toString("hex"),
    booking,
    pricing,
    issuedAt: Math.floor(now / 1000),
    expiresAt: Math.floor(now / 1000) + QUOTE_TTL_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    token: `${encodedPayload}.${sign(encodedPayload, secret)}`,
    payload,
  };
}

export function verifyQuoteToken(token, secret, now = Date.now()) {
  if (typeof token !== "string" || token.length > 4096) {
    throw new Error("Invalid quote token.");
  }

  const [encodedPayload, suppliedSignature, extra] = token.split(".");
  if (!encodedPayload || !suppliedSignature || extra) {
    throw new Error("Invalid quote token.");
  }

  const expectedSignature = sign(encodedPayload, secret);
  const expected = Buffer.from(expectedSignature);
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new Error("Invalid quote token.");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid quote token.");
  }

  if (
    payload?.version !== QUOTE_VERSION ||
    typeof payload.quoteId !== "string" ||
    !/^[a-f0-9]{24}$/.test(payload.quoteId) ||
    !payload.booking ||
    !payload.pricing ||
    !Number.isInteger(payload.expiresAt)
  ) {
    throw new Error("Invalid quote token.");
  }
  if (payload.expiresAt < Math.floor(now / 1000)) {
    throw new Error("This price quote has expired. Please try again.");
  }

  return payload;
}

export { QUOTE_TTL_SECONDS };
