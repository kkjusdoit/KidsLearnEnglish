import { query } from "./db.js";
import { signAdminToken } from "./admin-auth.js";
import { config } from "./config.js";

export function getAdminToken() {
  return signAdminToken();
}

export async function seedAdminDefaults() {
  await query(
    `
      insert into lessons (lesson_date, title, status)
      values (current_date, 'Today''s English', 'published')
      on conflict (lesson_date) do update set
        title = excluded.title,
        status = excluded.status
    `
  );

  if (config.nodeEnv === "production") return;
}
