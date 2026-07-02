---
name: lesson-video-intake
description: Use this skill when the user gives a local lesson video file such as .mp4 or .mov together with a lesson date and wants Codex to prepare daily lesson assets inside this project. It creates a dated working folder, runs the project's audio and image processing pipeline, and opens the output directory for manual review.
---

# Lesson Video Intake

Use this skill when the user says things like:

- “处理这个 video”
- “把这个老师视频切成今天课程素材”
- “给你一个 mp4，帮我打开工具并处理”
- “先把音频和图片草稿跑出来，我再人工校对”

This project already has working media scripts. Prefer the bundled script:

- `scripts/process-lesson-video.sh`

It will:

1. Check `ffmpeg` and `ffprobe`
2. Create a dated work directory under `work/lesson-prep/`
3. Run the project's `media:process` pipeline
4. Optionally import the processed assets into the local lesson data for that date
5. Optionally publish the reviewed assets to the remote server for that date
6. Open the output directory in Finder for manual review

## Inputs

- Required:
  - Absolute path to a local video file (`.mp4`, `.mov`, `.m4v`)
- Required:
  - Lesson date in `YYYY-MM-DD`
- Optional:
  - Ordered word list such as `crayon,paper,pencil,scissors,backpack,book`
  - Custom output directory

The date must be treated as the source of truth for:

1. output folder naming
2. generated draft asset date
3. later import command
4. final server-side lesson date

If the user does not provide words, still run the pipeline and let the generated pages stay as `Page 1`, `Page 2`, etc. for later manual correction.

## Workflow

Run:

```bash
bash .codex/skills/lesson-video-intake/scripts/process-lesson-video.sh \
  "/absolute/path/to/video.mp4" \
  "2026-07-03" \
  --words "crayon,paper,pencil,scissors,backpack,book"
```

Argument order and options:

1. video path
2. date
3. `--words "csv"` (optional)
4. `--output-dir "/abs/path"` (optional)
5. `--import` (optional)
6. `--deploy-remote` (optional)

Examples:

```bash
# With date
bash .codex/skills/lesson-video-intake/scripts/process-lesson-video.sh \
  "/Users/linkunkun/Desktop/lesson.mp4" \
  "2026-07-03"

# With date and words
bash .codex/skills/lesson-video-intake/scripts/process-lesson-video.sh \
  "/Users/linkunkun/Desktop/lesson.mp4" \
  "2026-07-03" \
  --words "crayon,paper,pencil,scissors,backpack,book"

# With automatic local import after processing
bash .codex/skills/lesson-video-intake/scripts/process-lesson-video.sh \
  "/Users/linkunkun/Desktop/lesson.mp4" \
  "2026-07-03" \
  --words "crayon,paper,pencil,scissors,backpack,book" \
  --import

# With remote publish after processing
bash .codex/skills/lesson-video-intake/scripts/process-lesson-video.sh \
  "/Users/linkunkun/Desktop/lesson.mp4" \
  "2026-07-03" \
  --words "crayon,paper,pencil,scissors,backpack,book" \
  --deploy-remote
```

## Output

Default output directory:

- `work/lesson-prep/<date>-<video-name>/`

Expected files include:

- `cover.jpg`
- `manifest.json`
- `page-1.mp3`, `page-1.jpg`
- `page-2.mp3`, `page-2.jpg`

After processing, open the output directory and tell the user where it is.

When reporting completion, always include:

- the lesson date
- the output directory
- whether local import was executed
- whether remote publish was executed
- the exact import command for that same date

## Notes

- This skill prepares draft assets. It does not publish the lesson.
- The server side is date-based. Importing later will write to `lessons.lesson_date = YYYY-MM-DD`.
- `--import` means importing into the local project data for that date. It is not the same as deploying to the remote server.
- `--deploy-remote` uses the project's remote secrets and GCE instance defaults to publish the lesson for that date.
- To publish reviewed assets later, use:
  - `npm run media:import -w @kindergarten-english/api -- /abs/path/to/lesson-dir YYYY-MM-DD`
- If the user explicitly wants a fully manual image workflow, still use this skill to create the working directory and open it, but do not insist on auto-cropping.
