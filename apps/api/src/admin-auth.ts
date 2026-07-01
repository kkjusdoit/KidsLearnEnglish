import jwt from "jsonwebtoken";
import { config } from "./config.js";

export type AdminAuthContext = { mode: "admin" } | { mode: "guest" };

export function signAdminToken() {
  return jwt.sign({ mode: "admin" }, config.jwtSecret, { expiresIn: "12h" });
}

export function verifyAdminSecret(secret: string) {
  return Boolean(config.adminSharedSecret) && secret === config.adminSharedSecret;
}

export function verifyAdminAuthHeader(header?: string): AdminAuthContext {
  if (!header?.startsWith("Bearer ")) return { mode: "guest" };
  try {
    const payload = jwt.verify(header.slice("Bearer ".length), config.jwtSecret) as {
      mode?: string;
    };
    if (payload.mode === "admin") return { mode: "admin" };
  } catch {
    return { mode: "guest" };
  }
  return { mode: "guest" };
}
