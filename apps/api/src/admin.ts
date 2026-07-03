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
  carryCheckinDays: z.number().int().min(0).max(365).optional(),
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
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

  const [students, lessons, checkins] = await Promise.all([
    query(
      `
        select
          s.id,
          s.student_id,
          s.name,
          s.display_name,
          s.active,
          s.carry_checkin_days,
          s.historical_checkins_confirmed_at::text as historical_checkins_confirmed_at,
          count(sc.id)::int as total_checkin_days,
          coalesce(bool_or(sda.id is not null), false) as opened_today,
          coalesce(max(sda.open_count), 0)::int as open_count_today,
          max(sda.last_opened_at)::text as last_opened_at,
          coalesce(bool_or(scd.checkin_date is not null and scd.checked = true), false) as checked_today
        from students s
        left join student_checkin_days sc
          on sc.student_id = s.id
          and sc.checked = true
        left join student_daily_activity sda
          on sda.student_id = s.id
          and sda.activity_date = $1::date
        left join student_checkin_days scd
          on scd.student_id = s.id
          and scd.checkin_date = $1::date
        group by s.id
        order by
          case when s.student_id ~ '^[0-9]+$' then s.student_id::int end nulls last,
          s.student_id asc
      `,
      [today]
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
    summary: {
      totalStudents: students.rows.length,
      openedToday: students.rows.filter((row) => row.opened_today).length,
      checkedToday: students.rows.filter((row) => row.checked_today).length
    },
    students: students.rows.map((row) => ({
      id: row.id,
      studentId: row.student_id,
      name: row.name,
      displayName: row.display_name,
      active: row.active,
      carryCheckinDays: row.carry_checkin_days,
      historicalCheckinsConfirmed: Boolean(row.historical_checkins_confirmed_at),
      totalCheckinDays: row.total_checkin_days,
      openedToday: Boolean(row.opened_today),
      checkedToday: Boolean(row.checked_today),
      openCountToday: row.open_count_today,
      lastOpenedAt: row.last_opened_at
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
