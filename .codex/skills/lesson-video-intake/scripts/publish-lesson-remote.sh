#!/usr/bin/env bash
set -euo pipefail

LESSON_DIR="${1:-}"
LESSON_DATE="${2:-}"
LESSON_TITLE="${3:-}"

if [[ -z "$LESSON_DIR" ]]; then
  echo "Usage: bash .codex/skills/lesson-video-intake/scripts/publish-lesson-remote.sh /abs/path/to/lesson-dir [YYYY-MM-DD] [lesson_title]" >&2
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

if [[ -z "$LESSON_DATE" ]]; then
  LESSON_BASENAME="$(basename "$LESSON_DIR")"
  if [[ "$LESSON_BASENAME" =~ ^[0-9]{8}$ ]]; then
    LESSON_DATE="${LESSON_BASENAME:0:4}-${LESSON_BASENAME:4:2}-${LESSON_BASENAME:6:2}"
  elif [[ "$LESSON_BASENAME" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    LESSON_DATE="$LESSON_BASENAME"
  fi
fi

if [[ -z "$LESSON_DATE" || ! "$LESSON_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "Invalid lesson date: ${LESSON_DATE:-<empty>} (expected YYYY-MM-DD, or use a folder name like 20260703)" >&2
  exit 1
fi

if [[ -z "$LESSON_TITLE" ]]; then
  LESSON_TITLE="${LESSON_DATE} English"
fi

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
LOCAL_STAGE_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$LOCAL_STAGE_DIR"
}
trap cleanup EXIT

if [[ -z "$API_ORIGIN" || -z "$ADMIN_SHARED_SECRET" ]]; then
  echo "Missing API_ORIGIN or ADMIN_SHARED_SECRET in $SECRETS_FILE" >&2
  exit 1
fi

PAGES_JSON="$(
  LESSON_DIR="$LESSON_DIR" LESSON_DATE="$LESSON_DATE" LOCAL_STAGE_DIR="$LOCAL_STAGE_DIR" node <<'NODE'
const fs = require('fs');
const path = require('path');

const lessonDir = process.env.LESSON_DIR;
const lessonDate = process.env.LESSON_DATE;
const localStageDir = process.env.LOCAL_STAGE_DIR;

function normalizeDate(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  return null;
}

function pathExists(filePath) {
  return fs.existsSync(filePath);
}

function findAssetForOrder(order, kind) {
  const extensions = kind === 'audio'
    ? ['.mp3', '.m4a', '.wav', '.aac', '.webm', '.ogg']
    : ['.jpg', '.jpeg', '.png', '.webp'];
  const folders = kind === 'audio' ? ['', 'audio'] : ['', 'image'];
  const basenames = [`page-${order}`, `${order}`];

  for (const folder of folders) {
    for (const basename of basenames) {
      for (const extension of extensions) {
        const relativePath = folder ? path.join(folder, `${basename}${extension}`) : `${basename}${extension}`;
        if (pathExists(path.join(lessonDir, relativePath))) {
          return relativePath;
        }
      }
    }
  }
  return null;
}

function resolveWords(manifest) {
  if (Array.isArray(manifest?.words) && manifest.words.length) {
    return manifest.words.map((word) => String(word).trim()).filter(Boolean);
  }

  const wordsPath = path.join(lessonDir, 'words.txt');
  if (!pathExists(wordsPath)) {
    throw new Error('Need words.txt or manifest.json words/pages in lesson dir');
  }

  return fs.readFileSync(wordsPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function copyAsset(relativePath, targetBase) {
  const extension = path.extname(relativePath).toLowerCase();
  const targetName = `${targetBase}${extension}`;
  fs.copyFileSync(path.join(lessonDir, relativePath), path.join(localStageDir, targetName));
  return targetName;
}

function resolvePages() {
  const manifestPath = path.join(lessonDir, 'manifest.json');
  const manifest = pathExists(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : null;

  const manifestDate = normalizeDate(manifest?.date);
  if (manifestDate && manifestDate !== lessonDate) {
    throw new Error(`manifest.json date ${manifestDate} does not match lesson date ${lessonDate}`);
  }

  if (Array.isArray(manifest?.pages) && manifest.pages.length) {
    return manifest.pages
      .slice()
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
      .map((page, index) => {
        const order = page.order ?? index + 1;
        const audioSource = page.audio ?? findAssetForOrder(order, 'audio');
        const imageSource = page.image === null ? null : (page.image ?? findAssetForOrder(order, 'image'));
        if (!audioSource) {
          throw new Error(`Missing audio for page ${order}`);
        }
        if (!page.text || !String(page.text).trim()) {
          throw new Error(`Missing text for page ${order}`);
        }
        return {
          order,
          type: page.type ?? 'word',
          text: String(page.text).trim(),
          audioSource,
          imageSource,
          startMs: page.startMs ?? null,
          endMs: page.endMs ?? null
        };
      });
  }

  const words = resolveWords(manifest);
  return words.map((word, index) => {
    const order = index + 1;
    const audioSource = findAssetForOrder(order, 'audio');
    const imageSource = findAssetForOrder(order, 'image');
    if (!audioSource) {
      throw new Error(`Missing audio for page ${order}`);
    }
    return {
      order,
      type: 'word',
      text: word,
      audioSource,
      imageSource,
      startMs: null,
      endMs: null
    };
  });
}

fs.mkdirSync(localStageDir, { recursive: true });
const pages = resolvePages().map((page) => {
  const audioTarget = copyAsset(page.audioSource, `page-${page.order}`);
  const imageTarget = page.imageSource ? copyAsset(page.imageSource, `page-${page.order}`) : null;
  return {
    order: page.order,
    type: page.type,
    text: page.text,
    audioUrl: `/media/uploads/${lessonDate}/${audioTarget}`,
    imageUrl: imageTarget ? `/media/uploads/${lessonDate}/${imageTarget}` : null,
    startMs: page.startMs,
    endMs: page.endMs
  };
});

const coverCandidates = [
  path.join(lessonDir, 'cover.jpg'),
  path.join(lessonDir, 'cover.jpeg'),
  path.join(lessonDir, 'cover.png'),
  path.join(lessonDir, 'image', 'cover.jpg'),
  path.join(lessonDir, 'image', 'cover.jpeg'),
  path.join(lessonDir, 'image', 'cover.png')
];
const coverSource = coverCandidates.find((candidate) => pathExists(candidate));
if (coverSource) {
  const coverExt = path.extname(coverSource).toLowerCase();
  fs.copyFileSync(coverSource, path.join(localStageDir, `cover${coverExt}`));
}

process.stdout.write(JSON.stringify(pages));
NODE
)"

echo "Publishing lesson date: $LESSON_DATE"
echo "Lesson dir: $LESSON_DIR"
echo "Local stage dir: $LOCAL_STAGE_DIR"
echo "API origin: $API_ORIGIN"
echo "Remote instance: $INSTANCE ($ZONE)"

gcloud compute ssh "$INSTANCE" --zone "$ZONE" --command "rm -rf $REMOTE_STAGE_DIR && mkdir -p $REMOTE_STAGE_DIR"
gcloud compute scp --recurse "$LOCAL_STAGE_DIR/." "$INSTANCE:$REMOTE_STAGE_DIR" --zone "$ZONE"

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
