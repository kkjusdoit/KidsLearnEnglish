export type Student = {
  id: string;
  studentId: string;
  name: string;
  displayName: string;
  active: boolean;
};

export type LessonStatus = "draft" | "published";

export type Lesson = {
  id: string;
  date: string;
  title: string;
  status: LessonStatus;
  pages: LessonPage[];
};

export type LessonSummary = {
  id: string;
  date: string;
  title: string;
  status: LessonStatus;
  pageCount: number;
};

export type LessonPageType = "word" | "sentence";

export type LessonPage = {
  id: string;
  lessonId: string;
  order: number;
  type: LessonPageType;
  text: string;
  audioUrl: string;
  imageUrl?: string | null;
  startMs?: number | null;
  endMs?: number | null;
};

export type Checkin = {
  id: string;
  studentId: string;
  lessonId: string;
  completedAt: string;
  pageCount: number;
  rewardText: string;
};

export type Recording = {
  id: string;
  studentId: string;
  lessonId: string;
  pageId: string;
  audioUrl: string;
  createdAt: string;
  expiresAt: string;
};

export type IdentityResponse =
  | {
      mode: "student";
      token: string;
      student: Student;
    }
  | {
      mode: "guest";
      token: string;
    };

export type StudentStats = {
  totalCheckins: number;
  streakDays: number;
  completedToday: boolean;
  checkedDates: string[];
  campaignStartDate: string;
  campaignEndDate: string;
  latestRewardText?: string;
};

export * from "./admin";
