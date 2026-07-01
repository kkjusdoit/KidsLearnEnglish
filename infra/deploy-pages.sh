#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-kindergarten-english-mvp}"
API_ORIGIN="${API_ORIGIN:?Set API_ORIGIN, for example http://1.2.3.4:8080}"

npm run build -w @kindergarten-english/web
npx wrangler pages project create "$PROJECT_NAME" --production-branch main || true
npx wrangler pages secret put API_ORIGIN --project-name "$PROJECT_NAME" <<< "$API_ORIGIN"
(
  cd apps/web
  npx wrangler pages deploy dist --project-name "$PROJECT_NAME"
)
