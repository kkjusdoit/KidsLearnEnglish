import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Copy,
  Flower2,
  Pause,
  PencilLine,
  Play,
  RotateCcw,
  Sparkles,
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
      onError={() => {
        if (!usePreview) {
          setUsePreview(true);
        }
      }}
    />
  );
}

function FitText({ text, type }: { text: string; type: "word" | "sentence" }) {
  const length = text.length;
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
      {text}
    </h1>
  );
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

function App() {
  const [identifier, setIdentifier] = useState("");
  const [identity, setIdentity] = useState<IdentityResponse | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
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
  const showAdmin = new URLSearchParams(window.location.search).get("admin") === "1";
  const [mode, setMode] = useState<"student" | "admin">(showAdmin ? "admin" : "student");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    document.title = siteTitle;
    void loadTodayLesson();
    void refreshLessonList();
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
  const finishedCurrentLesson = Boolean(lesson && checkedDateSet.has(lesson.date));
  const rewardMessage = checkinReward ?? stats?.latestRewardText ?? "今天的英语打卡完成啦！";

  useEffect(() => {
    if (!lesson) {
      return;
    }

    const nextPage = lesson.pages[pageIndex + 1];
    if (!nextPage?.imageUrl) {
      return;
    }

    const cacheKey = `${lesson.id}-${nextPage.id}`;

    const original = new Image();
    original.src = mediaUrlWithCacheKey(nextPage.imageUrl, cacheKey);

    const preview = new Image();
    preview.src = mediaUrlWithCacheKey(previewImagePath(nextPage.imageUrl), `${cacheKey}-preview`);
  }, [lesson, pageIndex]);

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
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "识别失败");
    } finally {
      setLoading(false);
    }
  }

  async function playTeacherAudio(
    page = currentPage,
    options: { showBlockedMessage?: boolean } = {}
  ) {
    if (!page) return false;
    const { showBlockedMessage = true } = options;
    let audio = audioRef.current;
    if (!audio) {
      audio = new Audio();
      audio.preload = "auto";
      audioRef.current = audio;
    }

    audio.pause();
    setMessage(null);
    audio.onplay = () => setIsPlaying(true);
    audio.onpause = () => setIsPlaying(false);
    audio.onended = () => {
      setIsPlaying(false);
      if (autoMode && lesson && page.order < lesson.pages.length) {
        const nextPage = lesson.pages[page.order];
        window.setTimeout(() => {
          setPageIndex(page.order);
          void playTeacherAudio(nextPage, { showBlockedMessage: false });
        }, 650);
      }
    };

    const nextSrc = mediaUrl(page.audioUrl);
    const nextSrcAbsolute = new URL(nextSrc, window.location.href).href;
    if (audio.src !== nextSrcAbsolute) {
      audio.src = nextSrc;
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
      setIsPlaying(false);
      if (showBlockedMessage) {
        setMessage("请点一次“听老师读”开始播放，之后翻页会自动播放。");
      }
      return false;
    }
  }

  function goToPage(nextIndex: number) {
    if (!lesson) return;
    const boundedIndex = Math.max(0, Math.min(nextIndex, lesson.pages.length - 1));
    const nextPage = lesson.pages[boundedIndex];
    setPageIndex(boundedIndex);
    void playTeacherAudio(nextPage);
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
    setIsPlaying(false);
    setCheckinReward(null);
    setMessage(null);
    goToPage(0);
  }

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
