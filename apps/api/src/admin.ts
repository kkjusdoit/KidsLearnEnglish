import { z } from "zod";
import { query } from "./db.js";
import { verifyAdminAuthHeader } from "./admin-auth.js";

export function ensureAdmin(header?: string) {
  return verifyAdminAuthHeader(header).mode === "admin";
}

export const studentUpsertSchema = z.object({
  studentId: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(80),
  active: z.boolean().optional().default(true)
});

export const lessonUpsertSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().trim().min(1).max(120),
  status: z.enum(["draft", "published"])
});

export const lessonPageUpsertSchema = z.object({
  order: z.number().int().positive(),
  type: z.enum(["word", "sentence"]),
  text: z.string().trim().min(1).max(120),
  audioUrl: z.string().trim().min(1),
  imageUrl: z.string().trim().min(1).optional().nullable(),
  startMs: z.number().int().nonnegative().optional().nullable(),
  endMs: z.number().int().nonnegative().optional().nullable()
});

export async function getAdminDashboard() {
  const [students, lessons, checkins] = await Promise.all([
    query(
      "select id, student_id, name, display_name, active from students order by created_at desc"
    ),
    query(
      `
        select l.id, l.lesson_date::text as lesson_date, l.title, l.status,
          count(lp.id)::int as page_count
        from lessons l
        left join lesson_pages lp on lp.lesson_id = l.id
        group by l.id
        order by l.lesson_date desc
      `
    ),
    query(
      `
        select c.id, c.student_id, s.name as student_name, c.lesson_id, l.lesson_date::text as lesson_date,
          c.completed_at::text as completed_at, c.page_count, c.reward_text
        from checkins c
        join students s on s.id = c.student_id
        join lessons l on l.id = c.lesson_id
        order by c.completed_at desc
        limit 50
      `
    )
  ]);

  return {
    students: students.rows.map((row) => ({
      id: row.id,
      studentId: row.student_id,
      name: row.name,
      displayName: row.display_name,
      active: row.active
    })),
    lessons: lessons.rows.map((row) => ({
      id: row.id,
      date: row.lesson_date,
      title: row.title,
      status: row.status,
      pageCount: row.page_count
    })),
    checkins: checkins.rows.map((row) => ({
      id: row.id,
      studentId: row.student_id,
      studentName: row.student_name,
      lessonId: row.lesson_id,
      lessonDate: row.lesson_date,
      completedAt: row.completed_at,
      pageCount: row.page_count,
      rewardText: row.reward_text
    }))
  };
}

export async function listAdminLessons() {
  const rows = await query(
    `
      select l.id, l.lesson_date::text as lesson_date, l.title, l.status,
        count(lp.id)::int as page_count
      from lessons l
      left join lesson_pages lp on lp.lesson_id = l.id
      group by l.id
      order by l.lesson_date desc
    `
  );
  return rows.rows;
}
