import "dotenv/config";

function optionalBoolean(value: string | undefined, fallback: boolean) {
  if (value == null || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function required(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string) {
  return process.env[name] ?? "";
}

export function validateRuntimeConfig() {
  [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "SESSION_SECRET",
    "TOKEN_ENCRYPTION_KEY",
    "FRONTEND_URL",
    "BACKEND_PUBLIC_URL"
  ].forEach(required);
}

const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
const corsOrigins = (process.env.CORS_ORIGINS ?? frontendUrl)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  databasePoolMax: Number(process.env.DATABASE_POOL_MAX ?? 5),
  googleClientId: optional("GOOGLE_CLIENT_ID"),
  googleClientSecret: optional("GOOGLE_CLIENT_SECRET"),
  googleRedirectUri:
    process.env.GOOGLE_REDIRECT_URI ??
    `http://localhost:${process.env.PORT ?? 4000}/api/auth/google/callback`,
  sessionSecret: optional("SESSION_SECRET"),
  tokenEncryptionKey: optional("TOKEN_ENCRYPTION_KEY"),
  frontendUrl,
  backendPublicUrl:
    process.env.BACKEND_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`,
  runMigrations: optionalBoolean(process.env.RUN_MIGRATIONS, false),
  enableWorker: optionalBoolean(process.env.ENABLE_WORKER, true),
  corsOrigins,
  isProduction: process.env.NODE_ENV === "production"
};
