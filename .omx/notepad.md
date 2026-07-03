# OMX Notepad

## Priority Context

- 前端发布固定命令：`cd /Users/linkunkun/Documents/Codex/2026-07-01/zhe && API_ORIGIN=http://34.55.229.129.nip.io:8080 npm run deploy:web`。日常不要用 `npx wrangler pages deploy`。

## Working Memory

## MANUAL

- 部署认证卡顿已在 `infra/deploy-pages-direct.mjs` 修复：脚本会自动刷新 Wrangler OAuth token，并给 Cloudflare 请求加超时。只有 refresh token 失效时才需要手动跑一次 `npx wrangler login`。
