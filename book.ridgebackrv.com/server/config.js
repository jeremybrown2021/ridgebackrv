import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CLOVER_ENVIRONMENTS = {
  sandbox: {
    apiBaseUrl: "https://scl-sandbox.dev.clover.com",
    sdkUrl: "https://checkout.sandbox.dev.clover.com/sdk.js",
  },
  production: {
    apiBaseUrl: "https://scl.clover.com",
    sdkUrl: "https://checkout.clover.com/sdk.js",
  },
};

function loadDotEnv(filePath) {
  let contents;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function isTrue(value) {
  return String(value).toLowerCase() === "true";
}

export function loadConfig(projectRoot) {
  loadDotEnv(resolve(projectRoot, ".env"));

  const databaseUrl = process.env.DATABASE_URL || "";
  let parsedDatabaseUrl;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid MySQL connection URL.");
  }
  if (parsedDatabaseUrl.protocol !== "mysql:" || !parsedDatabaseUrl.hostname || !parsedDatabaseUrl.pathname.slice(1)) {
    throw new Error("DATABASE_URL must use mysql:// and include a host and database name.");
  }

  const databaseConnectionLimit = Number(process.env.DB_CONNECTION_LIMIT || 5);
  if (!Number.isInteger(databaseConnectionLimit) || databaseConnectionLimit < 1 || databaseConnectionLimit > 20) {
    throw new Error("DB_CONNECTION_LIMIT must be an integer between 1 and 20.");
  }

  const environment = process.env.CLOVER_ENVIRONMENT || "sandbox";
  if (!CLOVER_ENVIRONMENTS[environment]) {
    throw new Error("CLOVER_ENVIRONMENT must be sandbox or production.");
  }

  const paymentsEnabled = isTrue(process.env.PAYMENTS_ENABLED);
  const requiredPaymentSettings = {
    CLOVER_MERCHANT_ID: process.env.CLOVER_MERCHANT_ID,
    CLOVER_PUBLIC_TOKEN: process.env.CLOVER_PUBLIC_TOKEN,
    CLOVER_PRIVATE_TOKEN: process.env.CLOVER_PRIVATE_TOKEN,
    CLOVER_QUOTE_SECRET: process.env.CLOVER_QUOTE_SECRET,
  };

  if (paymentsEnabled) {
    const missing = Object.entries(requiredPaymentSettings)
      .filter(([, value]) => !value)
      .map(([key]) => key);
    if (missing.length) {
      throw new Error(`Payments are enabled but these settings are missing: ${missing.join(", ")}`);
    }
    if (requiredPaymentSettings.CLOVER_QUOTE_SECRET.length < 32) {
      throw new Error("CLOVER_QUOTE_SECRET must contain at least 32 characters.");
    }
    if (environment === "production") {
      throw new Error(
        "Production payments are blocked in this build until the live reservation hold adapter is implemented.",
      );
    }
  }

  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port.");
  }
  const appOrigin = process.env.APP_ORIGIN || `http://localhost:${port}`;
  let parsedAppOrigin;
  try {
    parsedAppOrigin = new URL(appOrigin);
  } catch {
    throw new Error("APP_ORIGIN must be a valid URL.");
  }
  if (!["http:", "https:"].includes(parsedAppOrigin.protocol)) {
    throw new Error("APP_ORIGIN must use http or https.");
  }

  const sessionHours = Number(process.env.AUTH_SESSION_HOURS || 12);
  const rememberDays = Number(process.env.AUTH_REMEMBER_DAYS || 30);
  const resetMinutes = Number(process.env.AUTH_RESET_MINUTES || 30);
  if (!Number.isInteger(sessionHours) || sessionHours < 1 || sessionHours > 168) {
    throw new Error("AUTH_SESSION_HOURS must be an integer from 1 through 168.");
  }
  if (!Number.isInteger(rememberDays) || rememberDays < 1 || rememberDays > 365) {
    throw new Error("AUTH_REMEMBER_DAYS must be an integer from 1 through 365.");
  }
  if (!Number.isInteger(resetMinutes) || resetMinutes < 5 || resetMinutes > 120) {
    throw new Error("AUTH_RESET_MINUTES must be an integer from 5 through 120.");
  }
  const localAuthHost = ["localhost", "127.0.0.1", "::1"].includes(parsedAppOrigin.hostname);
  const exposeResetLinks = process.env.AUTH_EXPOSE_RESET_LINKS === undefined
    ? localAuthHost
    : isTrue(process.env.AUTH_EXPOSE_RESET_LINKS);
  const smtpHost = String(process.env.SMTP_HOST || "").trim();
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpUser = String(process.env.SMTP_USER || "").trim();
  const smtpPassword = String(process.env.SMTP_PASSWORD || "");
  const smtpFrom = String(process.env.AUTH_FROM_EMAIL || "Ridgeback RV <no-reply@ridgebackrv.com>").trim();
  if (smtpHost && (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535)) {
    throw new Error("SMTP_PORT must be a valid TCP port.");
  }
  if ((smtpUser && !smtpPassword) || (!smtpUser && smtpPassword)) {
    throw new Error("SMTP_USER and SMTP_PASSWORD must be configured together.");
  }
  if (!exposeResetLinks && !smtpHost) {
    throw new Error("SMTP_HOST is required when AUTH_EXPOSE_RESET_LINKS is disabled.");
  }

  return {
    projectRoot,
    port,
    appOrigin,
    trustProxy: isTrue(process.env.TRUST_PROXY),
    paymentsEnabled,
    database: {
      url: databaseUrl,
      connectionLimit: databaseConnectionLimit,
    },
    auth: {
      sessionHours,
      rememberDays,
      resetMinutes,
      secureCookies: parsedAppOrigin.protocol === "https:",
      exposeResetLinks,
      smtp: smtpHost ? {
        host: smtpHost,
        port: smtpPort,
        secure: process.env.SMTP_SECURE === undefined ? smtpPort === 465 : isTrue(process.env.SMTP_SECURE),
        user: smtpUser,
        password: smtpPassword,
        from: smtpFrom,
      } : null,
    },
    clover: {
      environment,
      merchantId: process.env.CLOVER_MERCHANT_ID || "",
      publicToken: process.env.CLOVER_PUBLIC_TOKEN || "",
      privateToken: process.env.CLOVER_PRIVATE_TOKEN || "",
      quoteSecret: process.env.CLOVER_QUOTE_SECRET || "",
      webhookAuthCode: process.env.CLOVER_WEBHOOK_AUTH_CODE || "",
      ...CLOVER_ENVIRONMENTS[environment],
    },
  };
}

export { CLOVER_ENVIRONMENTS };
