export type AdminLessonSummary = {
  id: string;
  date: string;
  title: string;
  status: "draft" | "published";
  pageCount: number;
};

export type AdminStudent = {
  id: string;
  studentId: string;
  name: string;
  displayName: string;
  active: boolean;
  carryCheckinDays: number;
  historicalCheckinsConfirmed: boolean;
  totalCheckinDays: number;
  openedToday: boolean;
  checkedToday: boolean;
  openCountToday: number;
  lastOpenedAt?: string | null;
};

export type AdminLessonPage = {
  id: string;
  lessonId: string;
  order: number;
  type: "word" | "sentence";
  text: string;
  audioUrl: string;
  imageUrl?: string | null;
  startMs?: number | null;
  endMs?: number | null;
};

export type AdminCheckin = {
  id: string;
  studentId: string;
  studentName: string;
  lessonId: string;
  lessonDate: string;
  completedAt: string;
  pageCount: number;
  rewardText: string;
};

export type AdminDashboard = {
  summary: {
    totalStudents: number;
    openedToday: number;
    checkedToday: number;
  };
  students: AdminStudent[];
  lessons: AdminLessonSummary[];
  checkins: AdminCheckin[];
};
