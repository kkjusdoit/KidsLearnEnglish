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

- 学号：`26`
- 姓名：`安梓西`

未匹配姓名或学号会进入游客模式。

## 媒体处理

用 FFmpeg 从老师视频里抽取静音分段：

```bash
npm run media:analyze -w @kindergarten-english/api -- /path/to/video.mp4
```

脚本会输出建议的 `LessonPage` JSON 片段，发布前需要人工校对每页文本和音频。

## 部署

详见 [infra/DEPLOYMENT.md](infra/DEPLOYMENT.md)。

# KidsLearnEnglish
