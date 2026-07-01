import { useEffect, useMemo, useState } from "react";
import type { ReactNode, FormEvent } from "react";
import type {
  AdminCheckin,
  AdminDashboard,
  AdminLessonSummary,
  AdminStudent
} from "@kindergarten-english/shared";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

async function adminRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "管理员请求失败");
  return body as T;
}

function Section({
  title,
  children,
  action
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="admin-section">
      <div className="admin-section-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function AdminPanel() {
  const [token, setToken] = useState("");
  const [secret, setSecret] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [studentForm, setStudentForm] = useState({ studentId: "", name: "", displayName: "" });
  const [lessonForm, setLessonForm] = useState<{ date: string; title: string; status: "draft" | "published" }>({
    date: "",
    title: "",
    status: "draft"
  });
  const [pageDraft, setPageDraft] = useState("");

  useEffect(() => {
    if (!token && import.meta.env.DEV) {
      adminRequest<{ token: string }>("/api/admin/bootstrap-token", "", {})
        .then((result) => setBootstrapToken(result.token))
        .catch(() => undefined);
    }
  }, [token]);

  async function refresh(currentToken: string) {
    const data = await adminRequest<AdminDashboard>("/api/admin/dashboard", currentToken);
    setDashboard(data);
  }

  useEffect(() => {
    if (bootstrapToken) {
      setToken(bootstrapToken);
      refresh(bootstrapToken).catch((err) => setError(err.message));
    }
  }, [bootstrapToken]);

  const lessonOptions = useMemo(() => dashboard?.lessons ?? [], [dashboard]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setError(null);
    await refresh(token);
  }

  async function loginWithSecret(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const result = await adminRequest<{ token: string }>("/api/admin/login", "", {
      method: "POST",
      body: JSON.stringify({ secret })
    });
    setToken(result.token);
    await refresh(result.token);
  }

  async function saveStudent() {
    setError(null);
    await adminRequest("/api/admin/students", token, {
      method: "POST",
      body: JSON.stringify(studentForm)
    });
    await refresh(token);
    setStudentForm({ studentId: "", name: "", displayName: "" });
  }

  async function saveLesson() {
    setError(null);
    const lesson = await adminRequest<{ id: string }>("/api/admin/lessons", token, {
      method: "POST",
      body: JSON.stringify(lessonForm)
    });
    const pages = JSON.parse(pageDraft || "[]") as unknown[];
    await adminRequest(`/api/admin/lessons/${lesson.id}/pages`, token, {
      method: "POST",
      body: JSON.stringify({ pages })
    });
    await refresh(token);
  }

  return (
    <main className="admin-shell">
      <header className="admin-hero">
        <div>
          <p>管理员后台</p>
          <h1>班级名单、课程和打卡</h1>
        </div>
        <div className="admin-auth">
          <form onSubmit={loginWithSecret} className="token-form">
            <input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="管理员密钥" />
            <button type="submit">登录后台</button>
          </form>
          <form onSubmit={login} className="token-form">
            <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="管理员 token" />
            <button type="submit">直接打开</button>
          </form>
        </div>
      </header>

      {error ? <div className="admin-error">{error}</div> : null}

      <Section title="学生名单">
        <div className="admin-grid">
          <input placeholder="学号" value={studentForm.studentId} onChange={(e) => setStudentForm((s) => ({ ...s, studentId: e.target.value }))} />
          <input placeholder="姓名" value={studentForm.name} onChange={(e) => setStudentForm((s) => ({ ...s, name: e.target.value }))} />
          <input placeholder="显示名" value={studentForm.displayName} onChange={(e) => setStudentForm((s) => ({ ...s, displayName: e.target.value }))} />
          <button type="button" onClick={saveStudent}>保存学生</button>
        </div>
        <div className="admin-table">
          {dashboard?.students.map((student: AdminStudent) => (
            <div key={student.id} className="admin-row">
              <span>{student.studentId}</span>
              <span>{student.name}</span>
              <span>{student.active ? "启用" : "停用"}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="今日课程">
        <div className="admin-grid">
          <input type="date" value={lessonForm.date} onChange={(e) => setLessonForm((s) => ({ ...s, date: e.target.value }))} />
          <input placeholder="标题" value={lessonForm.title} onChange={(e) => setLessonForm((s) => ({ ...s, title: e.target.value }))} />
          <select value={lessonForm.status} onChange={(e) => setLessonForm((s) => ({ ...s, status: e.target.value as "draft" | "published" }))}>
            <option value="draft">draft</option>
            <option value="published">published</option>
          </select>
          <textarea
            rows={10}
            value={pageDraft}
            onChange={(e) => setPageDraft(e.target.value)}
            placeholder='页面 JSON，例如：[{ "order":1, "type":"word", "text":"apple", "audioUrl":"/media/uploads/2026-07-01/page-1.mp3", "imageUrl":"/media/uploads/2026-07-01/cover.jpg", "startMs":0, "endMs":1500 }]'
          />
          <button type="button" onClick={saveLesson}>保存课程和页面</button>
        </div>
        <div className="admin-table">
          {lessonOptions.map((lesson: AdminLessonSummary) => (
            <div key={lesson.id} className="admin-row">
              <span>{lesson.date}</span>
              <span>{lesson.title}</span>
              <span>{lesson.pageCount} 页</span>
              <span>{lesson.status}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="打卡记录">
        <div className="admin-table">
          {dashboard?.checkins.map((checkin: AdminCheckin) => (
            <div key={checkin.id} className="admin-row">
              <span>{checkin.lessonDate}</span>
              <span>{checkin.studentName}</span>
              <span>{checkin.pageCount} 页</span>
              <span>{checkin.rewardText}</span>
            </div>
          ))}
        </div>
      </Section>
    </main>
  );
}
