import type { Checkin, IdentityResponse, Lesson, StudentStats } from "@kindergarten-english/shared";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL ??
  (import.meta.env.DEV ? "http://localhost:8080" : "");

export function mediaUrl(url: string) {
  if (url.startsWith("http")) return url;
  return `${API_BASE}${url}`;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? "请求失败，请稍后再试");
  }
  return body as T;
}

export async function identify(identifier: string) {
  return request<IdentityResponse>("/api/identify", {
    method: "POST",
    body: JSON.stringify({ identifier })
  });
}

export async function getTodayLesson() {
  return request<Lesson>("/api/lessons/today");
}

export async function createCheckin(params: {
  token: string;
  lessonId: string;
  pageCount: number;
}) {
  return request<Checkin>("/api/checkins", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`
    },
    body: JSON.stringify({
      lessonId: params.lessonId,
      pageCount: params.pageCount
    })
  });
}

export async function getStats(token: string) {
  return request<StudentStats>("/api/students/me/stats", {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export async function updateCheckinDay(params: {
  token: string;
  date: string;
  checked: boolean;
}) {
  return request<StudentStats>("/api/students/me/checkin-days", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`
    },
    body: JSON.stringify({
      date: params.date,
      checked: params.checked
    })
  });
}
