import jwt from "jsonwebtoken";
import { config } from "./config.js";

export type AuthContext =
  | { mode: "guest" }
  | { mode: "student"; studentUuid: string; studentId: string; name: string };

export function signGuestToken() {
  return jwt.sign({ mode: "guest" }, config.jwtSecret, { expiresIn: "30d" });
}

export function signStudentToken(student: {
  id: string;
  student_id: string;
  name: string;
}) {
  return jwt.sign(
    {
      mode: "student",
      studentUuid: student.id,
      studentId: student.student_id,
      name: student.name
    },
    config.jwtSecret,
    { expiresIn: "30d" }
  );
}

export function verifyAuthHeader(header?: string): AuthContext {
  if (!header?.startsWith("Bearer ")) return { mode: "guest" };
  try {
    const payload = jwt.verify(header.slice("Bearer ".length), config.jwtSecret) as {
      mode?: string;
      studentUuid?: string;
      studentId?: string;
      name?: string;
    };
    if (payload.mode === "student" && payload.studentUuid && payload.studentId) {
      return {
        mode: "student",
        studentUuid: payload.studentUuid,
        studentId: payload.studentId,
        name: payload.name ?? ""
      };
    }
  } catch {
    return { mode: "guest" };
  }
  return { mode: "guest" };
}
