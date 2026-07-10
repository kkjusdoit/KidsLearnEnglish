import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  CalendarDays,
  Copy,
  Flower2,
  Pause,
  PencilLine,
  Play,
  RotateCcw,
  Sparkles,
  Volume2,
  UserRound
} from "lucide-react";
import type { IdentityResponse, Lesson, LessonSummary, StudentStats } from "@kindergarten-english/shared";
import {
  createCheckin,
  getLessonByDate,
  getStats,
  getTodayLesson,
  identify,
  listLessons,
  mediaUrl,
  updateCheckinDay
} from "./api";
import { AdminPanel } from "./admin";

const siteTitle = "京师幼学实验小一班英语打卡网站";
const challengeStartDate = "2026-06-29";
const quizFeedbackPlaybackRate = 1.5;
const quizFeedbackSoundMap = {
  correct: "/sounds/quiz-correct.mp3",
  wrong: "/sounds/quiz-wrong.mp3"
} as const;

type QuizPage = {
  id: string;
  lessonId: string;
  order: number;
  type: "word";
  text: string;
  audioUrl: string;
  imageUrl: string;
  lessonDate: string;
  lessonTitle: string;
};

type QuizQuestion = {
  id: string;
  prompt: QuizPage;
  options: QuizPage[];
};

function previewImagePath(url: string) {
  return url.replace(/(\.[a-z0-9]+)(\?.*)?$/i, ".preview.jpg$2");
}

function mediaUrlWithCacheKey(url: string, cacheKey: string) {
  const resolved = mediaUrl(url);
  const separator = resolved.includes("?") ? "&" : "?";
  return `${resolved}${separator}v=${encodeURIComponent(cacheKey)}`;
}

function LessonImage({ imageUrl, alt, cacheKey }: { imageUrl: string; alt: string; cacheKey: string }) {
  const originalSrc = mediaUrlWithCacheKey(imageUrl, cacheKey);
  const previewSrc = mediaUrlWithCacheKey(previewImagePath(imageUrl), `${cacheKey}-preview`);
  const [usePreview, setUsePreview] = useState(false);

  useEffect(() => {
    setUsePreview(false);
  }, [originalSrc]);

  return (
    <img
      src={usePreview ? previewSrc : originalSrc}
      alt={alt}
      loading="eager"
      decoding="async"
      fetchPriority="high"
      onError={() => {
        if (!usePreview) {
          setUsePreview(true);
        }
      }}
    />
  );
}

function preloadLessonImages(lesson: Lesson, startIndex = 0) {
  const orderedPages = [
    ...lesson.pages.slice(startIndex),
    ...lesson.pages.slice(0, startIndex)
  ];

  for (const page of orderedPages) {
    if (!page.imageUrl) continue;
    const cacheKey = `${lesson.id}-${page.id}`;

    const original = new Image();
    original.decoding = "async";
    original.src = mediaUrlWithCacheKey(page.imageUrl, cacheKey);

    const preview = new Image();
    preview.decoding = "async";
    preview.src = mediaUrlWithCacheKey(previewImagePath(page.imageUrl), `${cacheKey}-preview`);
  }
}

function FitText({ text, type }: { text: string; type: "word" | "sentence" }) {
  const displayText = formatStudyText(text);
  const length = displayText.length;
  const size =
    type === "word"
      ? length > 10
        ? "clamp(2.8rem, 13vw, 4.2rem)"
        : "clamp(3.5rem, 18vw, 5.4rem)"
      : length > 24
        ? "clamp(2.1rem, 8vw, 3.1rem)"
        : "clamp(2.5rem, 10vw, 4rem)";

  return (
    <h1 className={`study-text ${type}`} style={{ fontSize: size }}>
      {displayText}
    </h1>
  );
}

function formatStudyText(text: string) {
  const trimmed = text.trim();
  if (/^[A-Za-z]$/.test(trimmed)) {
    return `${trimmed.toUpperCase()} ${trimmed.toLowerCase()}`;
  }
  return text;
}

function formatCheckinDay(day: number) {
  const keycapDigits: Record<string, string> = {
    "0": "0️⃣",
    "1": "1️⃣",
    "2": "2️⃣",
    "3": "3️⃣",
    "4": "4️⃣",
    "5": "5️⃣",
    "6": "6️⃣",
    "7": "7️⃣",
    "8": "8️⃣",
    "9": "9️⃣"
  };
  return String(day)
    .split("")
    .map((digit) => keycapDigits[digit] ?? digit)
    .join("");
}

function formatLessonDate(date: string) {
  const parsed = new Date(`${date}T12:00:00+08:00`);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(parsed);
}

function formatFullDate(date: string) {
  const parsed = new Date(`${date}T12:00:00+08:00`);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(parsed);
}

function challengeDayFor(date: string) {
  const start = new Date(`${challengeStartDate}T12:00:00+08:00`).getTime();
  const current = new Date(`${date}T12:00:00+08:00`).getTime();
  const day = Math.floor((current - start) / 86_400_000) + 1;
  return Math.max(day, 1);
}

function dateKeyInShanghai(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}

function buildCalendarDays(startDate: string, endDate: string) {
  const days: Array<{ date: string; dayNumber: string }> = [];
  const cursor = new Date(`${startDate}T12:00:00+08:00`);
  const end = new Date(`${endDate}T12:00:00+08:00`);

  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    days.push({
      date,
      dayNumber: String(cursor.getUTCDate())
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

function shuffleItems<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function uniqueQuizPages(pages: QuizPage[]) {
  const seen = new Set<string>();
  return pages.filter((page) => {
    const key = page.text.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function lessonToQuizPages(lesson: Lesson): QuizPage[] {
  return lesson.pages
    .filter((page) => page.type === "word" && page.imageUrl)
    .map((page) => ({
      id: page.id,
      lessonId: page.lessonId,
      order: page.order,
      type: "word" as const,
      text: page.text,
      audioUrl: page.audioUrl,
      imageUrl: page.imageUrl ?? "",
      lessonDate: lesson.date,
      lessonTitle: lesson.title
    }));
}

function buildQuizQuestions(pages: QuizPage[], desiredCount: number) {
  const pool = uniqueQuizPages(pages);
  if (pool.length < 2) {
    return [];
  }

  const prompts = shuffleItems(pool).slice(0, Math.min(desiredCount, pool.length));
  return prompts.map((prompt) => {
    const distractors = shuffleItems(pool.filter((candidate) => candidate.id !== prompt.id)).slice(
      0,
      Math.min(3, pool.length - 1)
    );
    return {
      id: `${prompt.lessonDate}-${prompt.id}`,
      prompt,
      options: shuffleItems([prompt, ...distractors])
    };
  });
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function App() {
  const [identifier, setIdentifier] = useState("");
  const [identity, setIdentity] = useState<IdentityResponse | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [activityMode, setActivityMode] = useState<"study" | "quiz">("study");
  const [lessonLoadError, setLessonLoadError] = useState<string | null>(null);
  const [loadingLesson, setLoadingLesson] = useState(true);
  const [lessonMode, setLessonMode] = useState<"today" | "review">("today");
  const [stats, setStats] = useState<StudentStats | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [autoMode, setAutoMode] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [checkinReward, setCheckinReward] = useState<string | null>(null);
  const [editingCalendar, setEditingCalendar] = useState(false);
  const [savingDate, setSavingDate] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizLoadingMode, setQuizLoadingMode] = useState<"current" | "all" | null>(null);
  const [quizMode, setQuizMode] = useState<"current" | "all">("current");
  const [quizLimit, setQuizLimit] = useState<string>("default");
  const [quizLabel, setQuizLabel] = useState("");
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizCorrectCount, setQuizCorrectCount] = useState(0);
  const [quizChoiceId, setQuizChoiceId] = useState<string | null>(null);
  const [quizAnswered, setQuizAnswered] = useState(false);
  const [quizResult, setQuizResult] = useState<"correct" | "wrong" | null>(null);
  const [allQuizPages, setAllQuizPages] = useState<QuizPage[] | null>(null);
  const showAdmin = new URLSearchParams(window.location.search).get("admin") === "1";
  const [mode, setMode] = useState<"student" | "admin">(showAdmin ? "admin" : "student");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preloadedAudioRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const feedbackAudioContextRef = useRef<AudioContext | null>(null);
  const feedbackAudioRef = useRef<Record<"correct" | "wrong", HTMLAudioElement | null>>({
    correct: null,
    wrong: null
  });
  const quizRunIdRef = useRef(0);
  const quizAdvanceTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    document.title = siteTitle;
    void loadTodayLesson();
    void refreshLessonList();
  }, []);

  useEffect(() => {
    for (const result of ["correct", "wrong"] as const) {
      const audio = new Audio(quizFeedbackSoundMap[result]);
      audio.preload = "auto";
      audio.playbackRate = quizFeedbackPlaybackRate;
      audio.load();
      feedbackAudioRef.current[result] = audio;
    }

    return () => {
      feedbackAudioRef.current.correct?.pause();
      feedbackAudioRef.current.wrong?.pause();
      feedbackAudioRef.current.correct = null;
      feedbackAudioRef.current.wrong = null;
      clearPendingQuizAdvance();
    };
  }, []);

  async function refreshLessonList() {
    try {
      setLessons(await listLessons());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "复习列表加载失败");
    }
  }

  async function loadTodayLesson() {
    setLoadingLesson(true);
    setLessonLoadError(null);
    try {
      const todayLesson = await getTodayLesson();
      setLesson(todayLesson);
      setLessonMode("today");
      setPageIndex(0);
      setCheckinReward(null);
    } catch (error) {
      setLesson(null);
      setLessonLoadError(error instanceof Error ? error.message : "今天的课程加载失败");
    } finally {
      setLoadingLesson(false);
    }
  }

  async function loadReviewLesson(date: string) {
    setLoadingLesson(true);
    setLessonLoadError(null);
    setMessage(null);
    try {
      const reviewLesson = await getLessonByDate(date);
      setLesson(reviewLesson);
      setLessonMode(date === todayKey ? "today" : "review");
      setPageIndex(0);
      setCheckinReward(null);
    } catch (error) {
      setLessonLoadError(error instanceof Error ? error.message : "复习课程加载失败");
    } finally {
      setLoadingLesson(false);
    }
  }

  useEffect(() => {
    if (identity?.mode === "student") {
      setStats(null);
      getStats(identity.token).then(setStats).catch((error) => setMessage(error.message));
      return;
    }
    setStats(null);
  }, [identity]);

  const currentPage = lesson?.pages[pageIndex];
  const isLastPage = Boolean(lesson && pageIndex === lesson.pages.length - 1);
  const checkedDateSet = useMemo(() => new Set(stats?.checkedDates ?? []), [stats?.checkedDates]);
  const todayKey = dateKeyInShanghai();
  const todayText = formatFullDate(todayKey);
  const challengeDay = challengeDayFor(todayKey);
  const challengeDayText = formatCheckinDay(challengeDay);
  const calendarDays = useMemo(() => {
    if (!stats) return [];
    return buildCalendarDays(stats.campaignStartDate, stats.campaignEndDate);
  }, [stats]);
  const isTodayLesson = lesson?.date === todayKey;
  const shareDay = Math.max((stats?.totalCheckins ?? 0) + (stats?.completedToday ? 0 : 1), 1);
  const shareDayText = formatCheckinDay(shareDay);
  const studentName = identity?.mode === "student" ? identity.student.displayName : "小朋友";
  const shareText = `我是京师幼学蓝湾幼儿园小朋友 ${studentName}，👊👊挑战英文助力打卡第${shareDayText}天。说出口，刷到爆，连续打卡最闪耀！ Love English, From JSYX！🌟`;
  const finishedCurrentLesson = Boolean(
    lesson &&
      (lesson.date > todayKey
        ? checkedDateSet.has(todayKey)
        : checkedDateSet.has(lesson.date))
  );
  const rewardMessage = checkinReward ?? stats?.latestRewardText ?? "今天的英语打卡完成啦！";
  const currentQuizQuestion = quizQuestions[quizIndex];
  const quizFinished = activityMode === "quiz" && quizQuestions.length > 0 && quizIndex >= quizQuestions.length;
  const quizTotal = quizQuestions.length;
  const quizProgressText = quizFinished ? `${quizTotal} / ${quizTotal}` : `${quizIndex + 1} / ${quizTotal}`;

  useEffect(() => {
    if (!lesson) {
      return;
    }

    preloadLessonImages(lesson, pageIndex);
  }, [lesson, pageIndex]);

  function ensureAudioPreloaded(audioUrl: string) {
    const resolved = mediaUrl(audioUrl);
    const absolute = new URL(resolved, window.location.href).href;
    if (preloadedAudioRef.current.has(absolute)) {
      return;
    }

    const audio = new Audio();
    audio.preload = "auto";
    audio.src = resolved;
    audio.load();
    preloadedAudioRef.current.set(absolute, audio);
  }

  async function handleIdentify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lesson?.pages[0]) {
      void playTeacherAudio(lesson.pages[0], { showBlockedMessage: false });
    }
    setLoading(true);
    setMessage(null);
    try {
      const result = await identify(identifier);
      setIdentity(result);
      setCheckinReward(null);
      setPageIndex(0);
      if (result.mode === "guest") {
        setMessage("没有找到这个姓名或学号，已进入游客模式。游客可以点读，但不能正式打卡。");
      }
      setActivityMode("study");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "识别失败");
    } finally {
      setLoading(false);
    }
  }

  async function playTeacherAudio(
    page = currentPage,
    options: { showBlockedMessage?: boolean; retryCount?: number; allowLessonAutoAdvance?: boolean } = {}
  ) {
    if (!page) return false;
    const { showBlockedMessage = true, retryCount = 1, allowLessonAutoAdvance = true } = options;
    let audio = audioRef.current;
    if (!audio) {
      audio = new Audio();
      audio.preload = "auto";
      audioRef.current = audio;
    }

    stopFeedbackSound();
    audio.pause();
    setMessage(null);
    audio.onplay = () => setIsPlaying(true);
    audio.onpause = () => setIsPlaying(false);
    audio.onended = () => {
      setIsPlaying(false);
      if (allowLessonAutoAdvance && autoMode && lesson && page.order < lesson.pages.length) {
        const nextPage = lesson.pages[page.order];
        window.setTimeout(() => {
          setPageIndex(page.order);
          void playTeacherAudio(nextPage, { showBlockedMessage: false, allowLessonAutoAdvance: true });
        }, 650);
      }
    };

    const nextSrc = mediaUrl(page.audioUrl);
    const nextSrcAbsolute = new URL(nextSrc, window.location.href).href;
    if (audio.src !== nextSrcAbsolute) {
      audio.src = nextSrc;
      audio.load();
    }
    try {
      audio.currentTime = 0;
    } catch {
      // Some embedded mobile browsers reject seeking before metadata is ready.
    }

    try {
      await audio.play();
      return true;
    } catch {
      if (retryCount > 0) {
        await delay(180);
        return playTeacherAudio(page, {
          showBlockedMessage,
          retryCount: retryCount - 1,
          allowLessonAutoAdvance
        });
      }
      setIsPlaying(false);
      if (showBlockedMessage) {
        setMessage("请点一次“听老师读”开始播放，之后翻页会自动播放。");
      }
      return false;
    }
  }

  function stopFeedbackSound() {
    for (const result of ["correct", "wrong"] as const) {
      const audio = feedbackAudioRef.current[result];
      if (!audio) continue;
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch {
        // Ignore reset failures on browsers that have not finished attaching metadata yet.
      }
    }
  }

  function clearPendingQuizAdvance() {
    if (quizAdvanceTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(quizAdvanceTimeoutRef.current);
    quizAdvanceTimeoutRef.current = null;
  }

  function resetQuizFlow() {
    quizRunIdRef.current += 1;
    clearPendingQuizAdvance();
    stopFeedbackSound();
  }

  function getFeedbackAudioContext() {
    if (typeof window === "undefined" || typeof window.AudioContext === "undefined") {
      return null;
    }

    if (!feedbackAudioContextRef.current) {
      feedbackAudioContextRef.current = new window.AudioContext();
    }

    return feedbackAudioContextRef.current;
  }

  function playFeedbackTone(result: "correct" | "wrong") {
    const audioContext = getFeedbackAudioContext();
    if (!audioContext) {
      return;
    }

    if (audioContext.state === "suspended") {
      void audioContext.resume().catch(() => undefined);
    }

    const now = audioContext.currentTime + 0.01;
    const masterGain = audioContext.createGain();
    masterGain.connect(audioContext.destination);
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.exponentialRampToValueAtTime(result === "correct" ? 0.22 : 0.16, now + 0.04);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + (result === "correct" ? 0.9 : 0.62));

    const notes =
      result === "correct"
        ? [
            { frequency: 523.25, start: 0, duration: 0.18, type: "triangle" as OscillatorType },
            { frequency: 659.25, start: 0.16, duration: 0.18, type: "triangle" as OscillatorType },
            { frequency: 783.99, start: 0.32, duration: 0.26, type: "triangle" as OscillatorType },
            { frequency: 1046.5, start: 0.54, duration: 0.22, type: "sine" as OscillatorType }
          ]
        : [
            { frequency: 392, start: 0, duration: 0.2, type: "sine" as OscillatorType },
            { frequency: 349.23, start: 0.18, duration: 0.2, type: "sine" as OscillatorType },
            { frequency: 293.66, start: 0.36, duration: 0.18, type: "triangle" as OscillatorType }
          ];

    for (const note of notes) {
      const oscillator = audioContext.createOscillator();
      const noteGain = audioContext.createGain();
      oscillator.type = note.type;
      oscillator.frequency.setValueAtTime(note.frequency, now + note.start);
      noteGain.gain.setValueAtTime(0.0001, now + note.start);
      noteGain.gain.exponentialRampToValueAtTime(1, now + note.start + 0.03);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.duration);
      oscillator.connect(noteGain);
      noteGain.connect(masterGain);
      oscillator.start(now + note.start);
      oscillator.stop(now + note.start + note.duration);
    }
  }

  async function waitForFeedbackAudio(audio: HTMLAudioElement) {
    return await new Promise<number>((resolve) => {
      const fallbackMs =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? Math.min((audio.duration * 1000) / quizFeedbackPlaybackRate + 250, 3200)
          : 2200;

      const cleanup = () => {
        audio.removeEventListener("ended", handleEnded);
        audio.removeEventListener("error", handleError);
        window.clearTimeout(fallbackTimer);
      };

      const handleEnded = () => {
        cleanup();
        resolve(120);
      };

      const handleError = () => {
        cleanup();
        resolve(0);
      };

      const fallbackTimer = window.setTimeout(() => {
        cleanup();
        resolve(120);
      }, fallbackMs);

      audio.addEventListener("ended", handleEnded, { once: true });
      audio.addEventListener("error", handleError, { once: true });
    });
  }

  async function playFeedbackSound(result: "correct" | "wrong") {
    let audio = feedbackAudioRef.current[result];
    if (!audio) {
      audio = new Audio(quizFeedbackSoundMap[result]);
      audio.preload = "auto";
      audio.playbackRate = quizFeedbackPlaybackRate;
      audio.load();
      feedbackAudioRef.current[result] = audio;
    }

    try {
      stopFeedbackSound();
      audio.playbackRate = quizFeedbackPlaybackRate;
      audio.pause();
      audio.currentTime = 0;
      await audio.play();
      return await waitForFeedbackAudio(audio);
    } catch {
      playFeedbackTone(result);
      return result === "correct" ? 900 : 700;
    }
  }

  function goToPage(nextIndex: number) {
    if (!lesson) return;
    const boundedIndex = Math.max(0, Math.min(nextIndex, lesson.pages.length - 1));
    const nextPage = lesson.pages[boundedIndex];
    setPageIndex(boundedIndex);
    void playTeacherAudio(nextPage);
  }

  function resetQuizState() {
    resetQuizFlow();
    setQuizQuestions([]);
    setQuizIndex(0);
    setQuizCorrectCount(0);
    setQuizChoiceId(null);
    setQuizAnswered(false);
    setQuizResult(null);
  }

  function exitQuiz() {
    setActivityMode("study");
    resetQuizState();
  }

  async function loadAllQuizPages() {
    if (allQuizPages) {
      return allQuizPages;
    }

    const publishedLessons = lessons.filter((item) => item.status === "published");
    const lessonDetails = await Promise.all(publishedLessons.map((item) => getLessonByDate(item.date)));
    const pages = uniqueQuizPages(lessonDetails.flatMap((item) => lessonToQuizPages(item)));
    setAllQuizPages(pages);
    return pages;
  }

  async function startQuiz(mode: "current" | "all") {
    if (!lesson) return;
    resetQuizFlow();
    setQuizLoading(true);
    setQuizLoadingMode(mode);
    setMessage(null);
    try {
      setQuizMode(mode);
      const quizPages =
        mode === "current"
          ? lessonToQuizPages(lesson)
          : await loadAllQuizPages();
      
      let desiredCount = quizPages.length;
      if (quizLimit === "default") {
        desiredCount = mode === "current" ? quizPages.length : Math.min(8, quizPages.length);
      } else if (quizLimit === "all") {
        desiredCount = quizPages.length;
      } else {
        desiredCount = Math.min(Number(quizLimit), quizPages.length);
      }

      const questions = buildQuizQuestions(quizPages, desiredCount);
      if (questions.length === 0) {
        setMessage("题目还不够，至少要有两张不同的单词卡才能开始测试。");
        return;
      }

      setQuizMode(mode);
      setQuizLabel(mode === "current" ? `${formatLessonDate(lesson.date)} 小测试` : "全部单词小测试");
      setQuizQuestions(questions);
      for (const question of questions) {
        ensureAudioPreloaded(question.prompt.audioUrl);
      }
      setQuizIndex(0);
      setQuizCorrectCount(0);
      setQuizChoiceId(null);
      setQuizAnswered(false);
      setQuizResult(null);
      setActivityMode("quiz");
      void playTeacherAudio(questions[0].prompt, {
        showBlockedMessage: false,
        allowLessonAutoAdvance: false
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载测试题失败");
    } finally {
      setQuizLoading(false);
      setQuizLoadingMode(null);
    }
  }

  function advanceQuiz(nextIndex: number) {
    if (nextIndex >= quizQuestions.length) {
      setQuizIndex(quizQuestions.length);
      setQuizAnswered(false);
      setQuizChoiceId(null);
      setQuizResult(null);
      return;
    }

    const nextQuestion = quizQuestions[nextIndex];
    ensureAudioPreloaded(nextQuestion.prompt.audioUrl);
    const followingQuestion = quizQuestions[nextIndex + 1];
    if (followingQuestion) {
      ensureAudioPreloaded(followingQuestion.prompt.audioUrl);
    }
    setQuizIndex(nextIndex);
    setQuizAnswered(false);
    setQuizChoiceId(null);
    setQuizResult(null);
    void playTeacherAudio(nextQuestion.prompt, {
      showBlockedMessage: false,
      retryCount: 1,
      allowLessonAutoAdvance: false
    });
  }

  function answerQuiz(option: QuizPage) {
    if (!currentQuizQuestion || quizAnswered) {
      return;
    }

    const quizRunId = quizRunIdRef.current;
    const correct = option.id === currentQuizQuestion.prompt.id;
    const nextQuizIndex = quizIndex + 1;
    clearPendingQuizAdvance();
    audioRef.current?.pause();
    setIsPlaying(false);
    setQuizChoiceId(option.id);
    setQuizAnswered(true);
    setQuizResult(correct ? "correct" : "wrong");
    if (correct) {
      setQuizCorrectCount((value) => value + 1);
    }

    void (async () => {
      const delayMs = await playFeedbackSound(correct ? "correct" : "wrong");
      if (quizRunId !== quizRunIdRef.current) {
        return;
      }

      quizAdvanceTimeoutRef.current = window.setTimeout(() => {
        quizAdvanceTimeoutRef.current = null;
        if (quizRunId !== quizRunIdRef.current) {
          return;
        }

        advanceQuiz(nextQuizIndex);
      }, delayMs);
    })();
  }

  async function completeCheckin() {
    if (!lesson || identity?.mode !== "student" || !isLastPage) return;
    setLoading(true);
    setMessage(null);
    try {
      const result = await createCheckin({
        token: identity.token,
        lessonId: lesson.id,
        pageCount: lesson.pages.length
      });
      setCheckinReward(result.rewardText);
      const freshStats = await getStats(identity.token);
      setStats(freshStats);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "打卡失败");
    } finally {
      setLoading(false);
    }
  }

  async function copyShareText() {
    try {
      await navigator.clipboard.writeText(shareText);
      setMessage("打卡文案已复制");
    } catch {
      setMessage("复制失败，请长按文案手动复制");
    }
  }

  async function toggleCheckinDate(date: string) {
    if (identity?.mode !== "student" || !stats) return;
    setSavingDate(date);
    setMessage(null);
    try {
      const nextStats = await updateCheckinDay({
        token: identity.token,
        date,
        checked: !checkedDateSet.has(date)
      });
      setStats(nextStats);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "修改打卡天数失败");
    } finally {
      setSavingDate(null);
    }
  }

  function restartLesson() {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    stopFeedbackSound();
    setIsPlaying(false);
    setCheckinReward(null);
    setMessage(null);
    goToPage(0);
  }

  useEffect(() => {
    return () => {
      stopFeedbackSound();
      feedbackAudioContextRef.current?.close().catch(() => undefined);
    };
  }, []);

  if (showAdmin && mode === "admin") {
    return (
      <main className="shell">
        <div className="mode-switch">
          <button type="button" onClick={() => setMode("student")}>
            孩子端
          </button>
          <button type="button" className="active" onClick={() => setMode("admin")}>
            管理员
          </button>
        </div>
        <AdminPanel />
      </main>
    );
  }

  if (!lesson) {
    return (
      <main className="shell centered">
        <div className="loading-card">
          {loadingLesson ? (
            <>
              <span className="loading-date">今天是 {todayText}</span>
              <h1 className="loading-title">开启挑战打卡第{challengeDayText}天</h1>
              <p className="loading-note">小耳朵准备好，老师的声音马上到。今天也一起听一听、说出口，完成实验小一班的小小英文挑战。</p>
              <span className="loading-dots" aria-label="正在加载">
                <i />
                <i />
                <i />
              </span>
            </>
          ) : (
            <>
              <strong>{lessonLoadError ?? "课程还没有准备好"}</strong>
              <button type="button" onClick={() => void loadTodayLesson()}>
                重新加载
              </button>
            </>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      {showAdmin ? (
        <div className="mode-switch">
          <button type="button" className={mode === "student" ? "active" : ""} onClick={() => setMode("student")}>
            孩子端
          </button>
          <button type="button" className={mode === "admin" ? "active" : ""} onClick={() => setMode("admin")}>
            管理员
          </button>
        </div>
      ) : null}

      {showAdmin && mode === "admin" ? (
        <AdminPanel />
      ) : (
        <>
          <section className="brand-strip" aria-label="京师幼学蓝湾幼儿园 实验小一班">
            <img src="/jsyx-brand.png" alt="京师幼学蓝湾幼儿园" />
            <div className="school-name">
              <span>J·S·Y·X</span>
              <strong>京师幼学蓝湾幼儿园</strong>
            </div>
            <div className="class-mark">
              <span>实验小一班</span>
              <strong>English Learning Challenge</strong>
            </div>
          </section>

          <section className="topbar" aria-label="学习状态">
            <div>
              <p className="date-label">
                {lessonMode === "today" ? "今日课程" : "复习课程"} · {formatLessonDate(lesson.date)}
              </p>
              <strong>{identity?.mode === "student" ? `${identity.student.displayName}，开始吧` : siteTitle}</strong>
            </div>
            <div className="stats-pill">
              <Flower2 aria-hidden />
              <span>{stats ? `${stats.totalCheckins} 天` : "7 月挑战"}</span>
            </div>
          </section>

          <section className="lesson-switcher" aria-label="课程切换">
            <button
              type="button"
              className={lessonMode === "today" ? "active" : ""}
              disabled={loadingLesson}
              onClick={() => void loadTodayLesson()}
            >
              <Play size={20} />
              今日学习
            </button>
            <button
              type="button"
              className={lessonMode === "review" ? "active" : ""}
              disabled={loadingLesson || lessons.length === 0}
              onClick={() => {
                const firstReview = lessons.find((item) => item.date !== todayKey) ?? lessons[0];
                if (firstReview) void loadReviewLesson(firstReview.date);
              }}
            >
              <CalendarDays size={20} />
              往期复习
            </button>
            {lessonMode === "review" ? (
              <div className="review-picker">
                <CalendarDays size={18} aria-hidden />
                <select
                  value={lesson.date}
                  disabled={loadingLesson || lessons.length === 0}
                  onChange={(event) => void loadReviewLesson(event.target.value)}
                >
                  {lessons.length === 0 ? (
                    <option value={lesson.date}>暂无复习课</option>
                  ) : (
                    lessons.map((item) => (
                      <option key={item.id} value={item.date}>
                        {formatLessonDate(item.date)} · {item.pageCount} 页
                      </option>
                    ))
                  )}
                </select>
              </div>
            ) : null}
          </section>

          {!identity ? (
            <section className="identify-panel">
              <UserRound size={42} aria-hidden />
              <h1>输入姓名或学号</h1>
              <p>本班孩子可以直接学习和打卡；游客也可以先试学。</p>
              <form onSubmit={handleIdentify} className="identify-form">
                <input
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  placeholder="例如：4 或 测试账号"
                  autoFocus
                />
                <button disabled={loading || !identifier.trim()} type="submit">
                  进入学习
                </button>
              </form>
            </section>
          ) : (
            <section className="study-area">
              {activityMode === "study" ? (
                <>
                  <div className="progress-row">
                    <span>
                      {pageIndex + 1} / {lesson.pages.length}
                    </span>
                    <div className="progress-track" aria-hidden>
                      <div style={{ width: `${((pageIndex + 1) / lesson.pages.length) * 100}%` }} />
                    </div>
                    <label className="auto-toggle">
                      <input type="checkbox" checked={autoMode} onChange={(event) => setAutoMode(event.target.checked)} />
                      自动翻页
                    </label>
                  </div>

                  {currentPage ? (
                    <article className="study-card">
                      {currentPage.imageUrl ? (
                        <LessonImage
                          key={`${lesson.id}-${currentPage.id}-${currentPage.imageUrl}`}
                          imageUrl={currentPage.imageUrl}
                          alt={currentPage.text}
                          cacheKey={`${lesson.id}-${currentPage.id}`}
                        />
                      ) : null}
                      <FitText text={currentPage.text} type={currentPage.type} />
                      <p className="hint">{currentPage.type === "word" ? "Listen and repeat" : "Read after the teacher"}</p>

                      <div className="primary-actions">
                        <button className="round-action" onClick={() => void playTeacherAudio()}>
                          {isPlaying ? <Pause /> : <Play />}
                          <span>{isPlaying ? "重新播放" : "听老师读"}</span>
                        </button>
                      </div>
                    </article>
                  ) : null}

                  <div className="page-nav">
                    <button disabled={pageIndex === 0} onClick={() => goToPage(pageIndex - 1)}>
                      <ArrowLeft />
                      上一页
                    </button>
                    <button
                      disabled={pageIndex === lesson.pages.length - 1}
                      onClick={() => goToPage(pageIndex + 1)}
                    >
                      下一页
                      <ArrowRight />
                    </button>
                    <button onClick={restartLesson}>
                      <RotateCcw />
                      再来一遍
                    </button>
                  </div>
                </>
              ) : null}

              <section className="quiz-launch-panel">
                <div className="section-title">
                  <div>
                    <p>小测试</p>
                    <strong>听英文声音，选出正确单词</strong>
                  </div>
                </div>
                <div className="quiz-config-row">
                  <span>题目数量：</span>
                  <select
                    value={quizLimit}
                    onChange={(event) => setQuizLimit(event.target.value)}
                    className="quiz-limit-select"
                  >
                    <option value="default">默认数量</option>
                    <option value="4">4 题</option>
                    <option value="8">8 题</option>
                    <option value="12">12 题</option>
                    <option value="16">16 题</option>
                    <option value="20">20 题</option>
                    <option value="all">所有题目</option>
                  </select>
                </div>
                <div className="quiz-launch-actions">
                  <button type="button" className="mini-action" disabled={quizLoading} onClick={() => void startQuiz("current")}>
                    <CalendarDays />
                    {quizLoading && quizLoadingMode === "current" ? "准备中..." : "测试这节课"}
                  </button>
                  <button type="button" className="mini-action" disabled={quizLoading} onClick={() => void startQuiz("all")}>
                    <Brain />
                    {quizLoading && quizLoadingMode === "all" ? "准备中..." : "测试全部"}
                  </button>
                </div>
              </section>

              {activityMode === "quiz" ? (
                <section className={`quiz-panel ${quizResult === "correct" ? "celebrate" : ""}`}>
                  <div className="quiz-head">
                    <div>
                      <p>正在测试</p>
                      <strong>{quizLabel}</strong>
                    </div>
                    <button type="button" className="mini-action" onClick={exitQuiz}>
                      <ArrowLeft />
                      回到学习
                    </button>
                  </div>

                  {quizFinished ? (
                    <div className="quiz-summary">
                      <div className="quiz-face">😊</div>
                      <h2>测试完成</h2>
                      <p>这次答对了 {quizCorrectCount} / {quizTotal} 题。继续听一听、说一说，会越来越稳。</p>
                      <div className="quiz-summary-actions">
                        <button type="button" className="finish-button" onClick={() => void startQuiz(quizMode)}>
                          <RotateCcw />
                          再测一次
                        </button>
                      </div>
                    </div>
                  ) : currentQuizQuestion ? (
                    <>
                      <div className="quiz-progress-row">
                        <span>{quizProgressText}</span>
                        <div className="progress-track" aria-hidden>
                          <div style={{ width: `${((quizIndex + 1) / quizTotal) * 100}%` }} />
                        </div>
                        <span>答对 {quizCorrectCount} 题</span>
                      </div>

                      <div className="quiz-prompt">
                        <button
                          type="button"
                          className="round-action"
                          onClick={() =>
                            void playTeacherAudio(currentQuizQuestion.prompt, {
                              showBlockedMessage: false,
                              retryCount: 1,
                              allowLessonAutoAdvance: false
                            })
                          }
                        >
                          <Volume2 />
                          听题目
                        </button>
                        <p>听一听老师读的是哪个英文单词，再点下面正确的一张卡。</p>
                      </div>

                      <div className="quiz-options">
                        {currentQuizQuestion.options.map((option) => {
                          const isChosen = quizChoiceId === option.id;
                          const isCorrect = option.id === currentQuizQuestion.prompt.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              className={[
                                "quiz-option",
                                isChosen ? "selected" : "",
                                quizAnswered && isCorrect ? "correct" : "",
                                quizAnswered && isChosen && !isCorrect ? "wrong" : ""
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              disabled={quizAnswered}
                              onClick={() => answerQuiz(option)}
                            >
                              <LessonImage
                                key={`quiz-${option.lessonId}-${option.id}`}
                                imageUrl={option.imageUrl}
                                alt={option.text}
                                cacheKey={`quiz-${option.lessonId}-${option.id}`}
                              />
                              <strong>{option.text}</strong>
                            </button>
                          );
                        })}
                      </div>

                      {quizAnswered ? (
                        <div className={`quiz-feedback ${quizResult === "correct" ? "correct" : "wrong"}`}>
                          {quizResult === "correct" ? (
                            <>
                              <div className="quiz-face">😊</div>
                              <strong>答对啦</strong>
                              <p>太棒了，继续保持，我们马上下一题。</p>
                              <div className="quiz-confetti" aria-hidden>
                                <span />
                                <span />
                                <span />
                                <span />
                                <span />
                                <span />
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="quiz-face">😢</div>
                              <strong>这题先记一下</strong>
                              <p>没关系，再听一听就会了。你已经很认真，我们继续加油。</p>
                            </>
                          )}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </section>
              ) : null}

              {activityMode === "study" ? (
                <section className="finish-panel">
                  {identity.mode === "guest" ? (
                    <p>游客模式可以点读体验。输入本班姓名或学号后，就能正式打卡。</p>
                  ) : finishedCurrentLesson ? (
                    <div className="reward">
                      <img src="/jsyx-smile.png" alt="" />
                      <span className="reward-badge">完成第 {formatCheckinDay(stats?.totalCheckins ?? shareDay)} 天打卡</span>
                      <h2>恭喜 {studentName}</h2>
                      <p>{shareText}</p>
                      <strong>{rewardMessage}</strong>
                      <button type="button" className="share-copy-button" onClick={() => void copyShareText()}>
                        <Copy />
                        复制打卡文案
                      </button>
                    </div>
                  ) : (
                    <div className="finish-cta">
                      <button className="finish-button" onClick={() => void completeCheckin()} disabled={!isLastPage || loading}>
                        <Sparkles />
                        {isLastPage
                          ? loading
                            ? "打卡中..."
                            : isTodayLesson
                              ? "完成今日打卡"
                              : "完成复习打卡"
                          : "翻到最后一页即可打卡"}
                      </button>
                      <p>只要完成最后一页，就可以打卡。</p>
                    </div>
                  )}
                </section>
              ) : null}

              {identity.mode === "student" && stats ? (
                <>
                  <section className="share-panel">
                    <div className="section-title">
                      <div>
                        <p>打卡文案</p>
                        <strong>打开页面就能直接复制</strong>
                      </div>
                      <button type="button" className="mini-action" onClick={() => void copyShareText()}>
                        <Copy />
                        复制
                      </button>
                    </div>
                    <div className="share-copy-card">
                      <p>{shareText}</p>
                    </div>
                  </section>

                  <section className="calendar-panel">
                    <div className="section-title">
                      <div>
                        <p>打卡日历</p>
                        <strong>
                          {stats.campaignStartDate} - {stats.campaignEndDate}
                        </strong>
                      </div>
                      <button
                        type="button"
                        className={`mini-action ${editingCalendar ? "active" : ""}`}
                        onClick={() => setEditingCalendar((value) => !value)}
                      >
                        <PencilLine />
                        {editingCalendar ? "完成修改" : "修改打卡天数"}
                      </button>
                    </div>

                    <div className="calendar-weekdays">
                      {["一", "二", "三", "四", "五", "六", "日"].map((weekday) => (
                        <span key={weekday}>{weekday}</span>
                      ))}
                    </div>

                    <div className="calendar-grid">
                      {calendarDays.map((day) => {
                        const checked = checkedDateSet.has(day.date);
                        const editable = day.date < todayKey;
                        return (
                          <button
                            key={day.date}
                            type="button"
                            className={[
                              "calendar-day",
                              checked ? "checked" : "",
                              editingCalendar && editable ? "editable" : "",
                              savingDate === day.date ? "saving" : ""
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            disabled={!editingCalendar || !editable || savingDate !== null}
                            onClick={() => void toggleCheckinDate(day.date)}
                          >
                            <span>{day.dayNumber}</span>
                            <strong>{checked ? "✅" : editingCalendar && editable ? "○" : ""}</strong>
                          </button>
                        );
                      })}
                    </div>

                    <p className="calendar-tip">
                      {editingCalendar ? "现在可以修改过去的日期；今天和未来日期不会开放修改。" : "已打卡日期会显示 ✅。"}
                    </p>
                  </section>
                </>
              ) : null}
            </section>
          )}

          {message ? <div className="toast">{message}</div> : null}
        </>
      )}
    </main>
  );
}

export default App;
