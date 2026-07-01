import path from "node:path";

const numberFromEnv = (name: string, fallback: number) => {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: numberFromEnv("PORT", 8080),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5432/kindergarten_english",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-secret",
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  publicApiBaseUrl: process.env.PUBLIC_API_BASE_URL ?? "http://localhost:8080",
  adminSharedSecret: process.env.ADMIN_SHARED_SECRET ?? "",
  storageDriver: process.env.STORAGE_DRIVER ?? "local",
  localStorageDir: path.resolve(process.env.LOCAL_STORAGE_DIR ?? "./storage"),
  recordingRetentionDays: numberFromEnv("RECORDING_RETENTION_DAYS", 7)
};
