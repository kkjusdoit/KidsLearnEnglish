import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { z } from "zod";
import { signGuestToken, signStudentToken, verifyAuthHeader } from "./auth.js";
import { config } from "./config.js";
import { closeDb, query } from "./db.js";
import { migrate, seedDemoData } from "./schema.js";
import {
  ensureAdmin,
  lessonPageUpsertSchema,
  lessonUpsertSchema,
  studentUpsertSchema,
  getAdminDashboard,
  listAdminLessons
} from "./admin.js";
import { signAdminToken, verifyAdminSecret } from "./admin-auth.js";

const identifySchema = z.object({
  identifier: z.string().trim().min(1).max(40)
});

const checkinSchema = z.object({
  lessonId: z.string().uuid(),
  pageCount: z.number().int().positive()
});

function toLesson(row: {
  id: string;
  lesson_date: string;
  title: string;
  status: "draft" | "published";
}) {
  return {
    id: row.id,
    date: row.lesson_date,
    title: row.title,
    status: row.status
  };
}

function multipartFieldValue(field: unknown) {
  if (!field || Array.isArray(field)) return "";
  if (typeof field === "object" && "value" in field) {
    return String((field as { value?: unknown }).value ?? "");
  }
  return "";
}

const rewards = [
  "今天读得很认真，奖励一朵大红花！",
  "声音亮亮的，继续加油！",
  "你完成了今天的英语小任务，真棒！",
  "又多学会一点点，明天也来闯关吧！"
];

export async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: [config.webOrigin, "http://localhost:5173", "http://127.0.0.1:5173"],
    credentials: true
  });
  await app.register(multipart, {
    limits: {
      fileSize: 8 * 1024 * 1024,
      files: 1
    }
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Kindergarten English API",
        version: "0.1.0"
      }
    }
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  const storageDir = config.localStorageDir;
  await fs.mkdir(path.join(storageDir, "recordings"), { recursive: true });
  await fs.mkdir(path.join(storageDir, "uploads"), { recursive: true });

  await app.register(fastifyStatic, {
    root: storageDir,
    prefix: "/media/",
    decorateReply: false
  });

  app.get("/health", async () => ({ ok: true }));

  app.get("/api/admin/bootstrap-token", async (_request, reply) => {
    if (config.nodeEnv === "production") {
      return reply.code(403).send({ error: "production disabled" });
    }
    return { token: signAdminToken() };
  });

  app.post("/api/admin/login", async (request, reply) => {
    const body = z.object({ secret: z.string().min(1) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "请输入管理员密钥" });
    if (!verifyAdminSecret(body.data.secret)) {
      return reply.code(403).send({ error: "管理员密钥不正确" });
    }
    return { token: signAdminToken() };
  });

  app.get("/api/admin/dashboard", async (request, reply) => {
    if (!ensureAdmin(request.headers.authorization)) {
      return reply.code(403).send({ error: "需要管理员登录" });
    }
    return getAdminDashboard();
  });

  app.get("/api/admin/lessons", async (request, reply) => {
    if (!ensureAdmin(request.headers.authorization)) {
      return reply.code(403).send({ error: "需要管理员登录" });
    }
    return listAdminLessons();
  });

  app.post("/api/admin/students", async (request, reply) => {
    if (!ensureAdmin(request.headers.authorization)) {
      return reply.code(403).send({ error: "需要管理员登录" });
    }
    const parsed = studentUpsertSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "学生数据不正确" });

    const inserted = await query(
      `
        insert into students (student_id, name, display_name, active)
        values ($1, $2, $3, $4)
        on conflict (student_id)
        do update set name = excluded.name, display_name = excluded.display_name, active = excluded.active
        returning id, student_id, name, display_name, active
      `,
      [
        parsed.data.studentId,
        parsed.data.name,
        parsed.data.displayName,
        parsed.data.active
      ]
    );

    return inserted.rows[0];
  });

  app.post("/api/admin/lessons", async (request, reply) => {
    if (!ensureAdmin(request.headers.authorization)) {
      return reply.code(403).send({ error: "需要管理员登录" });
    }
    const parsed = lessonUpsertSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "课程数据不正确" });

    const inserted = await query(
      `
        insert into lessons (lesson_date, title, status)
        values ($1, $2, $3)
        on conflict (lesson_date)
        do update set title = excluded.title, status = excluded.status
        returning id, lesson_date::text as lesson_date, title, status
      `,
      [parsed.data.date, parsed.data.title, parsed.data.status]
    );

    return inserted.rows[0];
  });

  app.post("/api/admin/lessons/:lessonId/pages", async (request, reply) => {
    if (!ensureAdmin(request.headers.authorization)) {
      return reply.code(403).send({ error: "需要管理员登录" });
    }

    const lessonId = z.string().uuid().safeParse((request.params as { lessonId: string }).lessonId);
    if (!lessonId.success) return reply.code(400).send({ error: "课程不存在" });

    const parsed = z.object({
      pages: z.array(lessonPageUpsertSchema).min(1).max(20)
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "分页内容不正确" });

    await query("delete from lesson_pages where lesson_id = $1", [lessonId.data]);
    for (const page of parsed.data.pages) {
      await query(
        `
          insert into lesson_pages
            (lesson_id, page_order, page_type, text, audio_url, image_url, start_ms, end_ms)
          values ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          lessonId.data,
          page.order,
          page.type,
          page.text,
          page.audioUrl,
          page.imageUrl ?? null,
          page.startMs ?? null,
          page.endMs ?? null
        ]
      );
    }

    return { ok: true };
  });

  app.get("/api/admin/checkins", async (request, reply) => {
    if (!ensureAdmin(request.headers.authorization)) {
      return reply.code(403).send({ error: "需要管理员登录" });
    }
    const rows = await query(
      `
        select c.id, c.student_id, s.name as student_name, c.lesson_id, l.lesson_date::text as lesson_date,
          c.completed_at::text as completed_at, c.page_count, c.reward_text
        from checkins c
        join students s on s.id = c.student_id
        join lessons l on l.id = c.lesson_id
        order by c.completed_at desc
        limit 100
      `
    );
    return rows.rows;
  });

  app.get("/api/admin/recordings", async (request, reply) => {
    if (!ensureAdmin(request.headers.authorization)) {
      return reply.code(403).send({ error: "需要管理员登录" });
    }
    const rows = await query(
      `
        select r.id, r.audio_url, r.created_at::text as created_at, r.expires_at::text as expires_at,
          s.name as student_name, l.lesson_date::text as lesson_date
        from recordings r
        join students s on s.id = r.student_id
        join lessons l on l.id = r.lesson_id
        order by r.created_at desc
        limit 100
      `
    );
    return rows.rows;
  });

  app.post("/api/identify", async (request, reply) => {
    const parsed = identifySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "请输入姓名或学号" });
    }

    const identifier = parsed.data.identifier;
    const student = await query<{
      id: string;
      student_id: string;
      name: string;
      display_name: string;
      active: boolean;
    }>(
      `
        select id, student_id, name, display_name, active
        from students
        where active = true and (student_id = $1 or name = $1 or display_name = $1)
        limit 1
      `,
      [identifier]
    );

    if (!student.rows[0]) {
      return {
        mode: "guest",
        token: signGuestToken()
      };
    }

    const row = student.rows[0];
    return {
      mode: "student",
      token: signStudentToken(row),
      student: {
        id: row.id,
        studentId: row.student_id,
        name: row.name,
        displayName: row.display_name,
        active: row.active
      }
    };
  });

  app.get("/api/lessons/today", async (_request, reply) => {
    const lessons = await query<{
      id: string;
      lesson_date: string;
      title: string;
      status: "draft" | "published";
    }>(
      `
        select id, lesson_date::text, title, status
        from lessons
        where lesson_date = current_date and status = 'published'
        limit 1
      `
    );

    const lesson = lessons.rows[0];
    if (!lesson) {
      return reply.code(404).send({ error: "今天的课程还没有发布" });
    }

    const pages = await query<{
      id: string;
      lesson_id: string;
      page_order: number;
      page_type: "word" | "sentence";
      text: string;
      audio_url: string;
      image_url: string | null;
      start_ms: number | null;
      end_ms: number | null;
    }>(
      `
        select id, lesson_id, page_order, page_type, text, audio_url, image_url, start_ms, end_ms
        from lesson_pages
        where lesson_id = $1
        order by page_order asc
      `,
      [lesson.id]
    );

    return {
      ...toLesson(lesson),
      pages: pages.rows.map((page) => ({
        id: page.id,
        lessonId: page.lesson_id,
        order: page.page_order,
        type: page.page_type,
        text: page.text,
        audioUrl: page.audio_url,
        imageUrl: page.image_url,
        startMs: page.start_ms,
        endMs: page.end_ms
      }))
    };
  });

  app.post("/api/recordings", async (request, reply) => {
    const auth = verifyAuthHeader(request.headers.authorization);
    if (auth.mode !== "student") {
      return reply.code(403).send({ error: "游客不能保存录音" });
    }

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "缺少录音文件" });

    const lessonId = multipartFieldValue(data.fields.lessonId);
    const pageId = multipartFieldValue(data.fields.pageId);
    if (!z.string().uuid().safeParse(lessonId).success || !z.string().uuid().safeParse(pageId).success) {
      return reply.code(400).send({ error: "课程或页面参数不正确" });
    }

    const extension = data.mimetype.includes("webm") ? "webm" : "audio";
    const filename = `${auth.studentUuid}-${pageId}-${randomUUID()}.${extension}`;
    const relativePath = path.join("recordings", filename);
    const fullPath = path.join(storageDir, relativePath);
    await fs.writeFile(fullPath, await data.toBuffer());

    const expiresAt = new Date(
      Date.now() + config.recordingRetentionDays * 24 * 60 * 60 * 1000
    );
    const audioUrl = `/media/${relativePath}`;
    const inserted = await query<{ id: string; created_at: string; expires_at: string }>(
      `
        insert into recordings
          (student_id, lesson_id, page_id, audio_url, expires_at)
        values ($1, $2, $3, $4, $5)
        returning id, created_at::text, expires_at::text
      `,
      [auth.studentUuid, lessonId, pageId, audioUrl, expiresAt]
    );

    return reply.code(201).send({
      id: inserted.rows[0].id,
      studentId: auth.studentUuid,
      lessonId,
      pageId,
      audioUrl,
      createdAt: inserted.rows[0].created_at,
      expiresAt: inserted.rows[0].expires_at
    });
  });

  app.post("/api/checkins", async (request, reply) => {
    const auth = verifyAuthHeader(request.headers.authorization);
    if (auth.mode !== "student") {
      return reply.code(403).send({ error: "游客不能打卡" });
    }

    const parsed = checkinSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "打卡参数不正确" });

    const rewardText = rewards[Math.floor(Math.random() * rewards.length)];
    const inserted = await query<{
      id: string;
      completed_at: string;
      page_count: number;
      reward_text: string;
    }>(
      `
        insert into checkins (student_id, lesson_id, page_count, reward_text)
        values ($1, $2, $3, $4)
        on conflict (student_id, lesson_id)
        do update set completed_at = checkins.completed_at
        returning id, completed_at::text, page_count, reward_text
      `,
      [auth.studentUuid, parsed.data.lessonId, parsed.data.pageCount, rewardText]
    );

    return {
      id: inserted.rows[0].id,
      studentId: auth.studentUuid,
      lessonId: parsed.data.lessonId,
      completedAt: inserted.rows[0].completed_at,
      pageCount: inserted.rows[0].page_count,
      rewardText: inserted.rows[0].reward_text
    };
  });

  app.get("/api/students/me/stats", async (request, reply) => {
    const auth = verifyAuthHeader(request.headers.authorization);
    if (auth.mode !== "student") {
      return reply.code(403).send({ error: "游客没有个人统计" });
    }

    const rows = await query<{
      completed_day: string;
      reward_text: string;
    }>(
      `
        select completed_at::date::text as completed_day, reward_text
        from checkins
        where student_id = $1
        order by completed_day desc
      `,
      [auth.studentUuid]
    );

    const days = new Set(rows.rows.map((row) => row.completed_day));
    let streakDays = 0;
    const cursor = new Date();
    for (;;) {
      const key = cursor.toISOString().slice(0, 10);
      if (!days.has(key)) break;
      streakDays += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    return {
      totalCheckins: days.size,
      streakDays,
      completedToday: days.has(new Date().toISOString().slice(0, 10)),
      latestRewardText: rows.rows[0]?.reward_text
    };
  });

  app.post("/api/admin/cleanup-recordings", async (_request, reply) => {
    if (config.nodeEnv === "production") {
      return reply.code(403).send({ error: "production disabled" });
    }
    const expired = await query<{ id: string; audio_url: string }>(
      "select id, audio_url from recordings where expires_at < now()"
    );

    for (const row of expired.rows) {
      if (row.audio_url.startsWith("/media/")) {
        const filePath = path.join(storageDir, row.audio_url.replace("/media/", ""));
        await fs.rm(filePath, { force: true });
      }
    }

    await query("delete from recordings where expires_at < now()");
    return reply.send({ deleted: expired.rowCount ?? 0 });
  });

  return app;
}

async function main() {
  await migrate();
  await seedDemoData();
  const app = await buildServer();
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (error) => {
    console.error(error);
    await closeDb();
    process.exit(1);
  });
}
