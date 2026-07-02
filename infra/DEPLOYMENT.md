# 部署说明

## 当前线上环境

已经部署好的地址：

- 前端：`https://kindergarten-english-mvp.pages.dev`
- 后端公网：`http://34.55.229.129:8080`
- Pages Functions 上游：`http://34.55.229.129.nip.io:8080`
- GCE：`newapi-relay-1` / `us-central1-a`
- Cloudflare Pages project：`kindergarten-english-mvp`

后台默认不在孩子端页面暴露，访问 `https://kindergarten-english-mvp.pages.dev/?admin=1` 才会显示管理员入口。管理员密钥保存在 `outputs/deployment-secrets.txt`，不要发到班级群。

当前先用 `nip.io` 给 GCE IP 临时提供 hostname，避免 Cloudflare Pages Function 代理裸 IP 时触发 `error code: 1003`。后续拿到 Cloudflare DNS 编辑权限后，把 `english-api.aitifen.cc` 指到 `34.55.229.129`，再把 Pages secret `API_ORIGIN` 改成正式域名即可。

线上 smoke test：

```bash
curl https://kindergarten-english-mvp.pages.dev/api/lessons/today
curl -X POST https://kindergarten-english-mvp.pages.dev/api/identify \
  -H 'content-type: application/json' \
  --data '{"identifier":"26"}'
curl -I https://kindergarten-english-mvp.pages.dev/media/uploads/2026-07-01/page-1.mp3
```

## 每日更新课程

现在推荐直接走人工素材目录导入，不再依赖自动裁图作为主流程。

目录最低约定：

```text
page-1.jpg
page-1.mp3
page-2.jpg
page-2.mp3
words.txt
```

发布当天课程：

```bash
npm run media:import -w @kindergarten-english/api -- /abs/path/to/lesson-dir 2026-07-03
```

如果只是更新当天课程素材，不改页面代码，前端不用重新发。只需要把后端这次更新同步到 GCE 即可。

## 每日课程 SOP（从视频到上线）

这是现在最稳、最省心的一套流程，按这个做就行。

### 1. 你每天会用到的工具

- `ffmpeg`：`/opt/homebrew/bin/ffmpeg`
  - 用途：从老师视频里抽音频、抽封面、半自动切分音频
- `ffprobe`：`/opt/homebrew/bin/ffprobe`
  - 用途：辅助音频分析和时长检查
- 半自动音频/图片处理脚本：`/Users/linkunkun/Documents/Codex/2026-07-01/zhe/apps/api/scripts/process-media.ts`
  - 用途：先给出一版半自动音频切段和图片切块草稿
- 视频分析脚本：`/Users/linkunkun/Documents/Codex/2026-07-01/zhe/apps/api/scripts/analyze-media.ts`
  - 用途：分析老师视频里的语音分段
- 导入脚本：`/Users/linkunkun/Documents/Codex/2026-07-01/zhe/apps/api/scripts/import-lesson-media.ts`
  - 用途：把你已经确认好的 `page-1.jpg / page-1.mp3 / words.txt` 导入到网站数据
- 音视频工具函数：`/Users/linkunkun/Documents/Codex/2026-07-01/zhe/apps/api/scripts/media-utils.ts`
  - 用途：`process-media.ts` / `analyze-media.ts` 底层会调用这里的 FFmpeg 逻辑
- 后端部署脚本：`/Users/linkunkun/Documents/Codex/2026-07-01/zhe/infra/deploy-gce.sh`
  - 用途：把当天课程素材和后端同步到线上 GCE
- 前端直发脚本：`/Users/linkunkun/Documents/Codex/2026-07-01/zhe/infra/deploy-pages-direct.mjs`
  - 用途：只有页面代码改动时，才需要发 Pages

### 2. 准备一个当天素材目录

建议每天都建一个独立目录，例如：

```text
work/2026-07-03-lesson/
  lesson.mp4
  page-1.jpg
  page-1.mp3
  page-2.jpg
  page-2.mp3
  ...
  words.txt
```

最终能导入的网站目录，最低只需要这三类文件：

```text
page-1.jpg
page-1.mp3
page-2.jpg
page-2.mp3
words.txt
```

`words.txt` 里每行一个单词，顺序和页码一一对应。

### 3. 从视频提取音频和图片

推荐分成两种方式。

#### 方式 A：推荐，人工处理

适用场景：

- 单词之间挨得很近
- 自动裁图会带到相邻内容
- 需要你自己肉眼确认孩子看到的每一页效果

做法：

1. 把原始 `lesson.mp4` 放进当天目录
2. 用你本地已有的人工工具，把视频手工导出成按页素材目录
3. 导出结果至少要有：
   - `page-1.jpg`
   - `page-1.mp3`
   - `page-2.jpg`
   - `page-2.mp3`
   - ...
4. 自己快速看一遍图片和音频，确认编号、顺序、单词对应关系都对
5. 新建 `words.txt`

#### 方式 B：半自动草稿，再人工校正

先装好 `ffmpeg`，然后跑：

```bash
npm run media:process -w @kindergarten-english/api -- /abs/path/to/lesson.mp4 2026-07-03 /abs/path/to/output-dir --words crayon,paper,pencil,scissors,backpack,book
```

等价到底层工具就是：

```bash
/opt/homebrew/bin/ffmpeg
/Users/linkunkun/Documents/Codex/2026-07-01/zhe/apps/api/scripts/process-media.ts
```

这个脚本会自动生成一版：

- `page-1.mp3`
- `page-1.jpg`
- `page-2.mp3`
- `page-2.jpg`
- `manifest.json`

但这只是草稿，仍然要人工检查。尤其是：

- 音频起止点是否太早或太晚
- 图片是否切到相邻单词
- `words` 顺序是否和老师视频一致

### 4. 本地检查素材目录

你每天交给网站前，先确认这几个点：

- `page-N.jpg` 和 `page-N.mp3` 数量一致
- `words.txt` 行数和页数一致
- 页码从 `page-1` 连续编号，不要跳号
- 图片能直接看
- 音频能直接播

最简单的自查：

```bash
ls -1 /abs/path/to/lesson-dir
```

### 5. 导入到仓库

素材确认好以后，在仓库根目录运行：

```bash
npm run media:import -w @kindergarten-english/api -- /abs/path/to/lesson-dir 2026-07-03
```

这一步会做三件事：

- 把图片和音频复制到 `apps/api/storage/uploads/2026-07-03/`
- upsert 这一天的 `lesson`
- 替换这一天的 `lesson_pages`

如果你想自定义标题或页信息，可以在素材目录里放 `manifest.json`。

### 6. 部署到线上

这里要分清楚两种情况。

#### 情况 A：只改了当天课程素材

比如只是新的一天的图片、音频、词表变了，页面样式没改。

这时只需要同步后端：

```bash
infra/deploy-gce.sh
```

原因很简单：

- 当天课程数据和音频图片都在 API 这边
- 前端页面本身没有变
- Pages 上的孩子端会继续请求后端最新的 `/api/lessons/today`

也就是说，**日更课程通常不需要重新发前端**。

#### 情况 B：页面代码也改了

比如你让我改了按钮、文案、日历、样式、品牌条。

这时分两步：

1. 先同步后端

```bash
infra/deploy-gce.sh
```

2. 再发前端

```bash
npm run build
API_ORIGIN=http://34.55.229.129.nip.io:8080 node infra/deploy-pages-direct.mjs apps/web/dist
```

### 7. 上线后检查

最少检查这三个：

```bash
curl https://kindergarten-english-mvp.pages.dev/api/lessons/today
curl -X POST https://kindergarten-english-mvp.pages.dev/api/identify \
  -H 'content-type: application/json' \
  --data '{"identifier":"4"}'
curl -I https://kindergarten-english-mvp.pages.dev/media/uploads/2026-07-03/page-1.mp3
```

如果 `today` 返回的是新课程，`identify` 正常，`page-1.mp3` 返回 `200`，当天就算发布完成。

### 8. 最短版本

如果你只想记住最短路径，就记这 4 步：

1. 用人工工具把视频处理成 `page-N.jpg + page-N.mp3 + words.txt`
2. 跑 `npm run media:import -w @kindergarten-english/api -- /abs/path/to/lesson-dir YYYY-MM-DD`
3. 跑 `infra/deploy-gce.sh`
4. 用 `curl` 检查 `today` 和 `page-1.mp3`

## 前端更新方式

前端现在推荐优先用这个直连脚本，避开本机 `wrangler pages deploy` 在 Node 25 下偶发卡死的问题：

```bash
npm run build
API_ORIGIN=http://34.55.229.129.nip.io:8080 node infra/deploy-pages-direct.mjs apps/web/dist
```

只改前端页面时，直接跑上面两行就够了。

脚本会自动：

- 读取本机 `~/.wrangler/config/default.toml` 的 OAuth token
- 上传 `apps/web/dist` 静态资源到 Pages
- 生成一个最小代理 Worker，把 `/api/*` 和 `/media/*` 转发到 `API_ORIGIN`

## 快速重新部署

后端到 GCE：

```bash
infra/deploy-gce.sh
```

脚本会输出：

```bash
API_ORIGIN=http://x.x.x.x:8080
ADMIN_SHARED_SECRET=...
```

复制 `API_ORIGIN` 后部署前端：

```bash
API_ORIGIN=http://x.x.x.x.nip.io:8080 infra/deploy-pages.sh
```

前端会部署到 Cloudflare Pages 的 `*.pages.dev` HTTPS 地址。浏览器访问 Pages 地址时，`/api/*` 和 `/media/*` 会由 Pages Functions 代理到 GCE 后端，所以不需要你先配置自定义域名。

## 1. GCE 后端

目标实例：

- name: `newapi-relay-1`
- zone: `us-central1-a`

在本机上传代码或在服务器拉取仓库后：

```bash
cp apps/api/.env.example apps/api/.env
```

编辑 `apps/api/.env`：

```bash
NODE_ENV=production
PORT=8080
JWT_SECRET=换成高强度随机字符串
WEB_ORIGIN=https://你的前端域名
PUBLIC_API_BASE_URL=https://api.你的域名
RECORDING_RETENTION_DAYS=7
```

在服务器 `.env` 或 shell 中设置：

```bash
export POSTGRES_PASSWORD='换成高强度数据库密码'
export API_DOMAIN='api.你的域名'
export CADDY_EMAIL='你的邮箱'
```

启动：

```bash
docker compose up -d --build
```

健康检查：

```bash
curl https://api.你的域名/health
```

## 2. Cloudflare DNS

给 `api.你的域名` 添加 A 记录，指向 GCE 公网 IP。

建议 Cloudflare SSL/TLS 模式使用 Full (strict)。Caddy 会在 GCE 上自动申请证书。

## 3. Cloudflare Pages 前端

如果以后改成 Git 集成，构建配置：

- Root directory: `apps/web`
- Build command: `npm install && npm run build`
- Build output directory: `dist`

当前 CLI 部署会把 `API_ORIGIN` 写入 Pages secret。注意从 `apps/web` 目录发布，这样 `functions/` 才会被 Wrangler 一起上传：

```bash
API_ORIGIN=http://34.55.229.129.nip.io:8080 infra/deploy-pages.sh
```

## 4. 数据库备份

服务器上可用 cron 每天执行：

```bash
infra/gce/backup-postgres.sh
```

如需上传到 GCS，可设置：

```bash
export BACKUP_BUCKET=gs://你的备份桶名
```

## 5. 录音清理

录音默认 7 天过期。可用 cron 每天调用：

```bash
curl -X POST https://api.你的域名/api/admin/cleanup-recordings
```

后续生产化建议给该接口加管理员 token。
