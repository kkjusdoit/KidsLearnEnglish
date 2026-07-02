#!/usr/bin/env bash
set -euo pipefail

VIDEO_PATH="${1:-}"
LESSON_DATE="${2:-}"
shift $(( $# > 0 ? 1 : 0 )) || true
shift $(( $# > 0 ? 1 : 0 )) || true

WORDS_CSV=""
CUSTOM_OUTPUT_DIR=""
IMPORT_AFTER_PROCESS="false"
DEPLOY_REMOTE="false"

if [[ -z "$VIDEO_PATH" || -z "$LESSON_DATE" ]]; then
  echo "Usage: bash .codex/skills/lesson-video-intake/scripts/process-lesson-video.sh /absolute/path/to/video.mp4 YYYY-MM-DD [--words csv] [--output-dir dir] [--import] [--deploy-remote]" >&2
  exit 1
fi

if [[ ! "$LESSON_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "Invalid lesson date: $LESSON_DATE (expected YYYY-MM-DD)" >&2
  exit 1
fi

if [[ ! -f "$VIDEO_PATH" ]]; then
  echo "Video not found: $VIDEO_PATH" >&2
  exit 1
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --words)
      WORDS_CSV="${2:-}"
      shift 2
      ;;
    --output-dir)
      CUSTOM_OUTPUT_DIR="${2:-}"
      shift 2
      ;;
    --import)
      IMPORT_AFTER_PROCESS="true"
      shift
      ;;
    --deploy-remote)
      DEPLOY_REMOTE="true"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: bash .codex/skills/lesson-video-intake/scripts/process-lesson-video.sh /absolute/path/to/video.mp4 YYYY-MM-DD [--words csv] [--output-dir dir] [--import] [--deploy-remote]" >&2
      exit 1
      ;;
  esac
done

FFMPEG_BIN="${FFMPEG_BIN:-$(command -v ffmpeg || true)}"
FFPROBE_BIN="${FFPROBE_BIN:-$(command -v ffprobe || true)}"

if [[ -z "$FFMPEG_BIN" ]]; then
  echo "ffmpeg not found. Expected something like /opt/homebrew/bin/ffmpeg" >&2
  exit 1
fi

if [[ -z "$FFPROBE_BIN" ]]; then
  echo "ffprobe not found. Expected something like /opt/homebrew/bin/ffprobe" >&2
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
VIDEO_BASENAME="$(basename "$VIDEO_PATH")"
VIDEO_STEM="${VIDEO_BASENAME%.*}"
SAFE_STEM="$(printf '%s' "$VIDEO_STEM" | tr '[:space:]/' '--' | tr -cd '[:alnum:]-_')"
OUTPUT_DIR="${CUSTOM_OUTPUT_DIR:-$REPO_ROOT/work/lesson-prep/${LESSON_DATE}-${SAFE_STEM}}"

mkdir -p "$OUTPUT_DIR"

CMD=(
  npm run media:process -w @kindergarten-english/api --
  "$VIDEO_PATH"
  "$LESSON_DATE"
  "$OUTPUT_DIR"
)

if [[ -n "$WORDS_CSV" ]]; then
  CMD+=(--words "$WORDS_CSV")
fi

echo "Repo root: $REPO_ROOT"
echo "Lesson date: $LESSON_DATE"
echo "Using ffmpeg: $FFMPEG_BIN"
echo "Using ffprobe: $FFPROBE_BIN"
echo "Output dir: $OUTPUT_DIR"
echo "Auto import after process: $IMPORT_AFTER_PROCESS"
echo "Deploy remote after process: $DEPLOY_REMOTE"
echo "Running: ${CMD[*]}"

(
  cd "$REPO_ROOT"
  "${CMD[@]}"
)

if [[ "$IMPORT_AFTER_PROCESS" == "true" ]]; then
  echo
  echo "Importing lesson into local project data for $LESSON_DATE ..."
  (
    cd "$REPO_ROOT"
    npm run media:import -w @kindergarten-english/api -- "$OUTPUT_DIR" "$LESSON_DATE"
  )
fi

if [[ "$DEPLOY_REMOTE" == "true" ]]; then
  echo
  echo "Publishing lesson to remote server for $LESSON_DATE ..."
  bash "$SCRIPT_DIR/publish-lesson-remote.sh" "$OUTPUT_DIR" "$LESSON_DATE"
fi

if command -v open >/dev/null 2>&1; then
  open "$OUTPUT_DIR"
fi

echo
echo "Done."
echo "Lesson date:"
echo "  $LESSON_DATE"
echo "Review assets in:"
echo "  $OUTPUT_DIR"
echo
echo "If the draft looks good, import with:"
echo "  npm run media:import -w @kindergarten-english/api -- \"$OUTPUT_DIR\" \"$LESSON_DATE\""
