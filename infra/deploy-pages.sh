#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PROJECT_NAME="${PROJECT_NAME:-${CF_PAGES_PROJECT:-kindergarten-english-mvp}}"
API_ORIGIN="${API_ORIGIN:?Set API_ORIGIN, for example http://1.2.3.4:8080}"

export API_ORIGIN
export CF_PAGES_PROJECT="$PROJECT_NAME"

cd "$REPO_ROOT"

if [[ "${SKIP_WEB_BUILD:-0}" != "1" ]]; then
  npm run build -w @kindergarten-english/web
fi

node "$REPO_ROOT/infra/deploy-pages-direct.mjs" "$REPO_ROOT/apps/web/dist"
