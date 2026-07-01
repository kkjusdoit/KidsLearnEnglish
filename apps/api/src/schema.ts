import { query } from "./db.js";
import { migrations } from "./migrations.js";

export async function migrate() {
  await query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const applied = await query<{ name: string }>("select name from schema_migrations");
  const done = new Set(applied.rows.map((row) => row.name));

  for (const migration of migrations) {
    if (done.has(migration.name)) continue;
    await query(migration.sql);
    await query("insert into schema_migrations (name) values ($1)", [migration.name]);
  }
}

export async function seedDemoData() {
  await query(`
    insert into students (student_id, name, display_name)
    values
      ('22', '林君铭', '林君铭'),
      ('demo', '小朋友', '小朋友')
    on conflict (student_id) do nothing;
  `);

  const lesson = await query<{ id: string }>(
    `
      insert into lessons (lesson_date, title, status)
      values (current_date, 'Today''s English', 'published')
      on conflict (lesson_date) do update set
        title = excluded.title,
        status = excluded.status
      returning id;
    `
  );

  const lessonId = lesson.rows[0]?.id;
  if (!lessonId) return;

  const existing = await query<{ count: string }>(
    "select count(*)::text as count from lesson_pages where lesson_id = $1",
    [lessonId]
  );
  if (Number(existing.rows[0]?.count ?? 0) > 0) return;

  const pages = [
    ["word", "crayon", "/media/uploads/2026-07-01/page-1.mp3", "/media/uploads/2026-07-01/page-1.jpg", 765, 4162],
    ["word", "paper", "/media/uploads/2026-07-01/page-2.mp3", "/media/uploads/2026-07-01/page-2.jpg", 5868, 8986],
    ["word", "pencil", "/media/uploads/2026-07-01/page-3.mp3", "/media/uploads/2026-07-01/page-3.jpg", 10777, 13850],
    ["word", "scissors", "/media/uploads/2026-07-01/page-4.mp3", "/media/uploads/2026-07-01/page-4.jpg", 16254, 20178],
    ["word", "backpack", "/media/uploads/2026-07-01/page-5.mp3", "/media/uploads/2026-07-01/page-5.jpg", 22837, 26943],
    ["word", "book", "/media/uploads/2026-07-01/page-6.mp3", "/media/uploads/2026-07-01/page-6.jpg", 28616, 29173]
  ] as const;

  for (const [index, page] of pages.entries()) {
    await query(
      `
        insert into lesson_pages
          (lesson_id, page_order, page_type, text, audio_url, image_url, start_ms, end_ms)
        values ($1, $2, $3, $4, $5, $6, $7, $8);
      `,
      [lessonId, index + 1, ...page]
    );
  }
}
