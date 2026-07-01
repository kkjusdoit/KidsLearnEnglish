# 部署说明

## 快速部署

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
API_ORIGIN=http://x.x.x.x:8080 infra/deploy-pages.sh
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

构建配置：

- Root directory: `apps/web`
- Build command: `npm install && npm run build`
- Build output directory: `dist`

环境变量：

```bash
VITE_API_BASE_URL=https://api.你的域名
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
