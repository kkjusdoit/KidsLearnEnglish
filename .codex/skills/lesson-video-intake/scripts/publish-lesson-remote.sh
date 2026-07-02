#!/usr/bin/env bash
set -euo pipefail

LESSON_DIR="${1:-}"
LESSON_DATE="${2:-}"
LESSON_TITLE="${3:-${LESSON_DATE} English}"

if [[ -z "$LESSON_DIR" || -z "$LESSON_DATE" ]]; then
  echo "Usage: bash .codex/skills/lesson-video-intake/scripts/publish-lesson-remote.sh /abs/path/to/lesson-dir YYYY-MM-DD [lesson_title]" >&2
  exit 1
fi

if [[ ! "$LESSON_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "Invalid lesson date: $LESSON_DATE (expected YYYY-MM-DD)" >&2
  exit 1
fi

if [[ ! -d "$LESSON_DIR" ]]; then
  echo "Lesson directory not found: $LESSON_DIR" >&2
  exit 1
fi

SOURCE_PATH="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE_PATH" ]]; do
  SOURCE_DIR="$(cd "$(dirname "$SOURCE_PATH")" && pwd)"
  SOURCE_PATH="$(readlink "$SOURCE_PATH")"
  [[ "$SOURCE_PATH" != /* ]] && SOURCE_PATH="$SOURCE_DIR/$SOURCE_PATH"
done
SCRIPT_DIR="$(cd "$(dirname "$SOURCE_PATH")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../" && pwd)"
SECRETS_FILE="${SECRETS_FILE:-$REPO_ROOT/outputs/deployment-secrets.txt}"
INSTANCE="${INSTANCE:-newapi-relay-1}"
ZONE="${ZONE:-us-central1-a}"
REMOTE_REPO_DIR="${REMOTE_REPO_DIR:-~/kindergarten-english-mvp}"
REMOTE_STAGE_DIR="/tmp/ke-lesson-${LESSON_DATE}"

if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "Secrets file not found: $SECRETS_FILE" >&2
  exit 1
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud not found in PATH" >&2
  exit 1
fi

API_ORIGIN="$(awk -F= '$1=="API_ORIGIN"{print $2}' "$SECRETS_FILE")"
ADMIN_SHARED_SECRET="$(awk -F= '$1=="ADMIN_SHARED_SECRET"{print $2}' "$SECRETS_FILE")"

if [[ -z "$API_ORIGIN" || -z "$ADMIN_SHARED_SECRET" ]]; then
  echo "Missing API_ORIGIN or ADMIN_SHARED_SECRET in $SECRETS_FILE" >&2
  exit 1
fi

PAGES_JSON="$(
  LESSON_DIR="$LESSON_DIR" LESSON_DATE="$LESSON_DATE" node <<'NODE'
const fs = require('fs');
const path = require('path');

const lessonDir = process.env.LESSON_DIR;
const lessonDate = process.env.LESSON_DATE;
const manifestPath = path.join(lessonDir, 'manifest.json');

function buildFromManifest(manifest) {
  const pages = (manifest.pages || []).map((page, index) => ({
    order: page.order ?? index + 1,
    type: page.type ?? 'word',
    text: page.text,
    audioUrl: page.audioUrl ?? `/media/uploads/${lessonDate}/page-${index + 1}.mp3`,
    imageUrl: page.imageUrl ?? `/media/uploads/${lessonDate}/page-${index + 1}.jpg`,
    startMs: page.startMs ?? null,
    endMs: page.endMs ?? null
  }));
  return pages;
}

function buildFromWords() {
  const wordsPath = path.join(lessonDir, 'words.txt');
  const words = fs.readFileSync(wordsPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return words.map((word, index) => ({
    order: index + 1,
    type: 'word',
    text: word,
    audioUrl: `/media/uploads/${lessonDate}/page-${index + 1}.mp3`,
    imageUrl: fs.existsSync(path.join(lessonDir, `page-${index + 1}.jpg`))
      ? `/media/uploads/${lessonDate}/page-${index + 1}.jpg`
      : null,
    startMs: null,
    endMs: null
  }));
}

let pages;
if (fs.existsSync(manifestPath)) {
  pages = buildFromManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
} else {
  const wordsPath = path.join(lessonDir, 'words.txt');
  if (!fs.existsSync(wordsPath)) {
    throw new Error('Need manifest.json or words.txt in lesson dir');
  }
  pages = buildFromWords();
}

if (!pages.length) {
  throw new Error('No pages resolved from lesson dir');
}

process.stdout.write(JSON.stringify(pages));
NODE
)"

echo "Publishing lesson date: $LESSON_DATE"
echo "Lesson dir: $LESSON_DIR"
echo "API origin: $API_ORIGIN"
echo "Remote instance: $INSTANCE ($ZONE)"

gcloud compute ssh "$INSTANCE" --zone "$ZONE" --command "rm -rf $REMOTE_STAGE_DIR && mkdir -p $REMOTE_STAGE_DIR"
gcloud compute scp --recurse "$LESSON_DIR/." "$INSTANCE:$REMOTE_STAGE_DIR" --zone "$ZONE"

gcloud compute ssh "$INSTANCE" --zone "$ZONE" --command "
  set -euo pipefail
  cd $REMOTE_REPO_DIR
  API_CONTAINER=\$(sudo docker compose ps -q api)
  if [ -z \"\$API_CONTAINER\" ]; then
    echo 'API container not running' >&2
    exit 1
  fi
  sudo docker exec \"\$API_CONTAINER\" mkdir -p /app/storage/uploads/$LESSON_DATE
  sudo docker cp $REMOTE_STAGE_DIR/. \"\$API_CONTAINER:/app/storage/uploads/$LESSON_DATE/\"
"

ADMIN_TOKEN="$(
  API_ORIGIN="$API_ORIGIN" ADMIN_SHARED_SECRET="$ADMIN_SHARED_SECRET" node <<'NODE'
const apiOrigin = process.env.API_ORIGIN;
const secret = process.env.ADMIN_SHARED_SECRET;

async function main() {
  const response = await fetch(`${apiOrigin}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret })
  });
  const body = await response.json();
  if (!response.ok || !body.token) {
    throw new Error(body.error || 'admin login failed');
  }
  process.stdout.write(body.token);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
NODE
)"

LESSON_ID="$(
  API_ORIGIN="$API_ORIGIN" ADMIN_TOKEN="$ADMIN_TOKEN" LESSON_DATE="$LESSON_DATE" LESSON_TITLE="$LESSON_TITLE" node <<'NODE'
const apiOrigin = process.env.API_ORIGIN;
const token = process.env.ADMIN_TOKEN;
const date = process.env.LESSON_DATE;
const title = process.env.LESSON_TITLE;

async function main() {
  const response = await fetch(`${apiOrigin}/api/admin/lessons`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ date, title, status: 'published' })
  });
  const body = await response.json();
  if (!response.ok || !body.id) {
    throw new Error(body.error || 'lesson create failed');
  }
  process.stdout.write(body.id);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
NODE
)"

API_ORIGIN="$API_ORIGIN" ADMIN_TOKEN="$ADMIN_TOKEN" LESSON_ID="$LESSON_ID" PAGES_JSON="$PAGES_JSON" node <<'NODE'
const apiOrigin = process.env.API_ORIGIN;
const token = process.env.ADMIN_TOKEN;
const lessonId = process.env.LESSON_ID;
const pages = JSON.parse(process.env.PAGES_JSON);

async function main() {
  const response = await fetch(`${apiOrigin}/api/admin/lessons/${lessonId}/pages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ pages })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || 'page publish failed');
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
NODE

curl -fsSI "${API_ORIGIN}/media/uploads/${LESSON_DATE}/page-1.mp3" >/dev/null

echo
echo "Remote publish complete."
echo "Lesson date: $LESSON_DATE"
echo "Lesson id: $LESSON_ID"
echo "Media root: ${API_ORIGIN}/media/uploads/${LESSON_DATE}/"
