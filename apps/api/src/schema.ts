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
      ('26', '安梓西', '安梓西'),
      ('27', '赵文轩', '赵文轩'),
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
    ["word", "apple", "/media/demo/apple.mp3", 0, 1500],
    ["word", "banana", "/media/demo/banana.mp3", 2000, 3500],
    ["sentence", "I like apples.", "/media/demo/i-like-apples.mp3", 4000, 6500],
    ["sentence", "Good morning!", "/media/demo/good-morning.mp3", 7000, 9500]
  ] as const;

  for (const [index, page] of pages.entries()) {
    await query(
      `
        insert into lesson_pages
          (lesson_id, page_order, page_type, text, audio_url, start_ms, end_ms)
        values ($1, $2, $3, $4, $5, $6, $7);
      `,
      [lessonId, index + 1, ...page]
    );
  }
}
