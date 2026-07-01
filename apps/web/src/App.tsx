import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, ArrowRight, Flower2, Mic, Pause, Play, RotateCcw, Sparkles, UserRound } from "lucide-react";
import type { IdentityResponse, Lesson, Recording, StudentStats } from "@kindergarten-english/shared";
import { createCheckin, getStats, getTodayLesson, identify, mediaUrl, uploadRecording } from "./api";
import { AdminPanel } from "./admin";

type PageState = "idle" | "played" | "recorded";

function useRecorder() {
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    setBlob(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorder.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setBlob(new Blob(chunks.current, { type: recorder.mimeType || "audio/webm" }));
        setIsRecording(false);
      };
      recorder.start();
      setIsRecording(true);
    } catch {
      setError("没有拿到麦克风权限，可以先听读，再请家长帮忙打开权限。");
    }
  }

  function stop() {
    mediaRecorder.current?.stop();
  }

  function reset() {
    setBlob(null);
    setError(null);
  }

  return { blob, error, isRecording, start, stop, reset };
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

function App() {
  const [identifier, setIdentifier] = useState("");
  const [identity, setIdentity] = useState<IdentityResponse | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [stats, setStats] = useState<StudentStats | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageStates, setPageStates] = useState<Record<string, PageState>>({});
  const [recordings, setRecordings] = useState<Record<string, Recording>>({});
  const [autoMode, setAutoMode] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [checkinReward, setCheckinReward] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const showAdmin = new URLSearchParams(window.location.search).get("admin") === "1";
  const [mode, setMode] = useState<"student" | "admin">(showAdmin ? "admin" : "student");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recorder = useRecorder();

  useEffect(() => {
    getTodayLesson()
      .then(setLesson)
      .catch((error) => setMessage(error.message));
  }, []);

  useEffect(() => {
    if (identity?.mode === "student") {
      getStats(identity.token).then(setStats).catch(() => undefined);
    }
  }, [identity]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsPlaying(false);
    }
    recorder.reset();
  }, [pageIndex]);

  const currentPage = lesson?.pages[pageIndex];
  const completedPages = useMemo(
    () => Object.values(pageStates).filter((state) => state === "recorded" || state === "played").length,
    [pageStates]
  );
  const allDone = Boolean(lesson && completedPages >= lesson.pages.length);
  const checkinDay = stats?.totalCheckins ?? 1;
  const studentName = identity?.mode === "student" ? identity.student.displayName : "小朋友";

  async function handleIdentify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const result = await identify(identifier);
      setIdentity(result);
      if (result.mode === "guest") {
        setMessage("没有找到这个姓名或学号，已进入游客模式。游客可以点读，但不能保存录音和打卡。");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "识别失败");
    } finally {
      setLoading(false);
    }
  }

  async function playTeacherAudio() {
    if (!currentPage) return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsPlaying(false);
    }
    recorder.reset();
    setMessage(null);
    const audio = new Audio(mediaUrl(currentPage.audioUrl));
    audioRef.current = audio;
    audio.onplay = () => setIsPlaying(true);
    audio.onpause = () => setIsPlaying(false);
    audio.onended = () => {
      setIsPlaying(false);
      setPageStates((previous) => ({ ...previous, [currentPage.id]: "played" }));
      if (autoMode && lesson && pageIndex < lesson.pages.length - 1) {
        window.setTimeout(() => setPageIndex((index) => index + 1), 650);
      }
    };
    try {
      await audio.play();
    } catch {
      setMessage("播放被浏览器拦截了，请再点一次播放。");
    }
  }

  async function saveRecording() {
    if (!currentPage || !lesson || !recorder.blob || identity?.mode !== "student") return;
    setLoading(true);
    setMessage(null);
    try {
      const saved = await uploadRecording({
        token: identity.token,
        lessonId: lesson.id,
        pageId: currentPage.id,
        blob: recorder.blob
      });
      setRecordings((previous) => ({ ...previous, [currentPage.id]: saved }));
      setPageStates((previous) => ({ ...previous, [currentPage.id]: "recorded" }));
      recorder.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "录音保存失败");
    } finally {
      setLoading(false);
    }
  }

  async function completeCheckin() {
    if (!lesson || identity?.mode !== "student") return;
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

  function playMyRecording() {
    if (!currentPage) return;
    const saved = recordings[currentPage.id];
    if (!saved) return;
    new Audio(mediaUrl(saved.audioUrl)).play().catch(() => setMessage("录音暂时无法播放"));
  }

  if (!lesson) {
    return (
      <main className="shell centered">
        <div className="loading-card">正在准备今天的英语小任务...</div>
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
            <div className="class-mark">
              <span>实验小一班</span>
              <strong>English Learning Challenge</strong>
            </div>
          </section>

          <section className="topbar" aria-label="学习状态">
            <div>
              <p className="date-label">{lesson.title}</p>
              <strong>{identity?.mode === "student" ? `${identity.student.displayName}，开始吧` : "实验小一班英语点读"}</strong>
            </div>
            <div className="stats-pill">
              <Flower2 aria-hidden />
              <span>{stats ? `${stats.totalCheckins} 天` : "今日"}</span>
            </div>
          </section>

          {!identity ? (
            <section className="identify-panel">
              <UserRound size={42} aria-hidden />
              <h1>输入姓名或学号</h1>
              <p>本班孩子可以保存跟读和打卡；游客也可以先试学。</p>
              <form onSubmit={handleIdentify} className="identify-form">
                <input
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  placeholder="例如：22 或 林君铭"
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

              {currentPage && (
                <article className="study-card">
                  {currentPage.imageUrl ? <img src={mediaUrl(currentPage.imageUrl)} alt="" /> : null}
                  <FitText text={currentPage.text} type={currentPage.type} />
                  <p className="hint">{currentPage.type === "word" ? "Listen and repeat" : "Read after the teacher"}</p>

                  <div className="primary-actions">
                    <button className="round-action" onClick={playTeacherAudio} disabled={isPlaying}>
                      {isPlaying ? <Pause /> : <Play />}
                      <span>{isPlaying ? "正在播放" : "听老师读"}</span>
                    </button>

                    {identity.mode === "student" ? (
                      recorder.isRecording ? (
                        <button className="round-action recording" onClick={recorder.stop}>
                          <Pause />
                          <span>停止录音</span>
                        </button>
                      ) : (
                        <button className="round-action" onClick={recorder.start}>
                          <Mic />
                          <span>我来跟读</span>
                        </button>
                      )
                    ) : (
                      <button className="round-action muted" disabled>
                        <Mic />
                        <span>游客不保存</span>
                      </button>
                    )}
                  </div>

                  {recorder.error ? <p className="soft-message">{recorder.error}</p> : null}

                  {recorder.blob ? (
                    <div className="recording-panel">
                      <button onClick={() => new Audio(URL.createObjectURL(recorder.blob!)).play()}>听我的声音</button>
                      <button onClick={saveRecording} disabled={loading}>
                        保存这一页
                      </button>
                      <button onClick={recorder.reset} aria-label="重录">
                        <RotateCcw size={18} />
                      </button>
                    </div>
                  ) : null}

                  {recordings[currentPage.id] ? (
                    <button className="listen-mine" onClick={playMyRecording}>
                      已保存，听一下我的跟读
                    </button>
                  ) : null}
                </article>
              )}

              <div className="page-nav">
                <button disabled={pageIndex === 0} onClick={() => setPageIndex((index) => index - 1)}>
                  <ArrowLeft />
                  上一页
                </button>
                <button disabled={pageIndex === lesson.pages.length - 1} onClick={() => setPageIndex((index) => index + 1)}>
                  下一页
                  <ArrowRight />
                </button>
                <button onClick={playTeacherAudio}>
                  <RotateCcw />
                  再来一遍
                </button>
              </div>

              <section className="finish-panel">
                {identity.mode === "guest" ? (
                  <p>游客模式可以点读体验。输入本班姓名或学号后，就能保存录音和打卡。</p>
                ) : checkinReward ? (
                  <div className="reward">
                    <img src="/jsyx-smile.png" alt="" />
                    <span className="reward-badge">第 {checkinDay} 天打卡完成</span>
                    <h2>{studentName}，今天挑战成功！</h2>
                    <p>{checkinReward}</p>
                    <strong>Love English, From JSYX</strong>
                  </div>
                ) : (
                  <button className="finish-button" onClick={completeCheckin} disabled={!allDone || loading}>
                    <Sparkles />
                    完成今日打卡
                  </button>
                )}
              </section>
            </section>
          )}

          {message ? <div className="toast">{message}</div> : null}
        </>
      )}
    </main>
  );
}

export default App;
