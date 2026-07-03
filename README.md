# 幼儿英语点读打卡 MVP

本项目包含两个应用：

- `apps/web`：儿童端网页，适合部署到 Cloudflare Pages。
- `apps/api`：后端 API，适合用 Docker Compose 部署到 GCE 实例 `newapi-relay-1`。

## 本地启动

```bash
npm install
cp apps/api/.env.example apps/api/.env
npm run dev -w @kindergarten-english/api
npm run dev -w @kindergarten-english/web
```

默认地址：

- Web: `http://localhost:5173`
- API: `http://localhost:8080`

## 默认体验账号

本地开发数据库会自动种子：

- 学号：`4`
- 姓名：`测试账号`

未匹配姓名或学号会进入游客模式。

当前孩子端规则：

- 只保留“听老师读”，切页时自动播放当前页
- 只要翻到最后一页，就可以完成当天打卡
- 打卡页会显示可复制文案、7 月活动日历，以及过去日期的手动补打卡入口
- 管理员入口默认隐藏，只有 `?admin=1` 才显示

## 媒体处理

用 FFmpeg 从老师视频里抽取静音分段：

- `ffmpeg`: `/opt/homebrew/bin/ffmpeg`
- `ffprobe`: `/opt/homebrew/bin/ffprobe`
- 半自动处理脚本: `/Users/linkunkun/Documents/Codex/2026-07-01/zhe/apps/api/scripts/process-media.ts`
- 分析脚本: `/Users/linkunkun/Documents/Codex/2026-07-01/zhe/apps/api/scripts/analyze-media.ts`
- 项目内 skill: `/Users/linkunkun/Documents/Codex/2026-07-01/zhe/.codex/skills/lesson-video-intake`

```bash
npm run media:analyze -w @kindergarten-english/api -- /path/to/video.mp4
```

如果想直接“给一个 video 就开始处理”，优先用这个 skill：

```bash
bash /Users/linkunkun/Documents/Codex/2026-07-01/zhe/.codex/skills/lesson-video-intake/scripts/process-lesson-video.sh \
  /absolute/path/to/video.mp4 \
  2026-07-03 \
  --words crayon,paper,pencil,scissors,backpack,book
```

这里的 `2026-07-03` 不是装饰字段，而是整条链路的课程日期。它会同时用于：

- 输出目录命名
- 草稿素材日期
- 后续导入命令
- 服务器上的当天课程日期

如果你想让它在处理完成后，直接导入到本地课程数据，再加一个 `--import`：

```bash
bash /Users/linkunkun/Documents/Codex/2026-07-01/zhe/.codex/skills/lesson-video-intake/scripts/process-lesson-video.sh \
  /absolute/path/to/video.mp4 \
  2026-07-03 \
  --words crayon,paper,pencil,scissors,backpack,book \
  --import
```

如果你想让它在处理完成后，直接把这一天的课程发布到远端服务器，再加一个 `--deploy-remote`：

```bash
bash /Users/linkunkun/Documents/Codex/2026-07-01/zhe/.codex/skills/lesson-video-intake/scripts/process-lesson-video.sh \
  /absolute/path/to/video.mp4 \
  2026-07-03 \
  --words crayon,paper,pencil,scissors,backpack,book \
  --deploy-remote
```

脚本会输出建议的 `LessonPage` JSON 片段，发布前需要人工校对每页文本和音频。

## 人工素材导入

现在的推荐流程是人工准备好每天的音频和图片，再直接导入网站。

推荐直接用这个更省事的目录格式：

```text
20260703/
  audio/
    1.mp3
    2.mp3
  image/
    1.jpg
    2.jpg
  words.txt
```

`words.txt` 每行一个单词，顺序对应 `audio/1 + image/1`、`audio/2 + image/2`。

也兼容旧格式：

```text
my-lesson/
  page-1.jpg
  page-1.mp3
  page-2.jpg
  page-2.mp3
  words.txt
```

导入并发布当天课程：

```bash
npm run media:import -w @kindergarten-english/api -- /abs/path/to/20260703 2026-07-03
```

也支持直接传词表：

```bash
npm run media:import -w @kindergarten-english/api -- /abs/path/to/20260703 2026-07-03 --words crayon,paper,pencil,scissors,backpack,book
```

如果目录名就是 `20260703` 或 `2026-07-03`，导入脚本也能自动识别日期。  
如果目录里放 `manifest.json`，可覆盖标题、状态、每页文本和可选的 `startMs/endMs`。导入脚本会：

- 复制素材到 `apps/api/storage/uploads/<date>/`
- upsert 当天 `lessons`
- 替换当天 `lesson_pages`

线上发布当天课程：

```bash
bash /Users/linkunkun/Documents/Codex/2026-07-01/zhe/.codex/skills/lesson-video-intake/scripts/publish-lesson-remote.sh /abs/path/to/20260703 2026-07-03
```

这个发布脚本也直接支持 `audio/1.mp3 + image/1.jpg + words.txt` 目录，不需要你手工改成 `page-1.*`。

导入脚本绝对路径：

- `/Users/linkunkun/Documents/Codex/2026-07-01/zhe/apps/api/scripts/import-lesson-media.ts`

## 部署

详见 [infra/DEPLOYMENT.md](infra/DEPLOYMENT.md)。

如果是每天更新老师视频对应的课程素材，直接看 `infra/DEPLOYMENT.md` 里的“每日课程 SOP（从视频到上线）”。

如果只是发布前端页面，推荐直接用：

```bash
API_ORIGIN=http://34.55.229.129.nip.io:8080 npm run deploy:web
```

# KidsLearnEnglish
