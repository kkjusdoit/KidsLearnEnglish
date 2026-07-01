import fs from "node:fs/promises";
import path from "node:path";
import { detectAudioSegments, run } from "./media-utils.js";

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const rawArgs = process.argv.slice(2);
const positional: string[] = [];
const options = new Map<string, string>();

for (let index = 0; index < rawArgs.length; index += 1) {
  const arg = rawArgs[index];
  if (arg.startsWith("--")) {
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? rawArgs[index + 1];
    if (inlineValue === undefined) {
      index += 1;
    }
    options.set(key, value);
  } else {
    positional.push(arg);
  }
}

const input = positional[0];
const date = positional[1] ?? new Date().toISOString().slice(0, 10);
const outputRoot = positional[2] ?? path.resolve("storage", "uploads", date);
const words = splitCsv(options.get("words"));
const readsPerPage = Number(options.get("reads-per-page") ?? "2");
const soundPaddingMs = Number(options.get("sound-padding-ms") ?? "120");
const imageCrops = parseRects(options.get("image-crops"));
const cropGrid = parseRect(options.get("crop-grid"));

if (!input) {
  console.error(
    [
      "Usage:",
      "  npm run media:process -w @kindergarten-english/api -- /path/to/video.mp4 2026-07-01 [outdir]",
      "",
      "Options:",
      "  --words crayon,paper,pencil,scissors,backpack,book",
      "  --reads-per-page 2",
      "  --crop-grid x,y,width,height",
      "  --image-crops x,y,width,height;x,y,width,height;...",
      "  --sound-padding-ms 120"
    ].join("\n")
  );
  process.exit(1);
}

await fs.mkdir(outputRoot, { recursive: true });
const segments = detectAudioSegments(input);
const coverPath = path.join(outputRoot, "cover.jpg");

run("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-ss",
  "00:00:01",
  "-i",
  input,
  "-frames:v",
  "1",
  "-q:v",
  "2",
  coverPath,
  "-y"
]);

const pages = [];
const expectedPages = words.length || Math.ceil(segments.length / readsPerPage);
const pageSegments = groupSegments(segments, readsPerPage, expectedPages);
const warnings: string[] = [];

if (words.length && words.length !== pageSegments.length) {
  warnings.push(
    `words has ${words.length} item(s), but audio grouping produced ${pageSegments.length} page(s). Please review manually.`
  );
}

if (segments.length !== expectedPages * readsPerPage) {
  warnings.push(
    `Detected ${segments.length} spoken segment(s); expected about ${expectedPages * readsPerPage} for ${expectedPages} page(s) x ${readsPerPage} read(s). The last page may need manual boundary review.`
  );
}

for (const [index, groupedSegments] of pageSegments.entries()) {
  const firstSegment = groupedSegments[0];
  const lastSegment = groupedSegments.at(-1);
  if (!firstSegment || !lastSegment) {
    continue;
  }

  const segment = {
    startMs: Math.max(0, firstSegment.startMs - soundPaddingMs),
    endMs: lastSegment.endMs + soundPaddingMs
  };

  const filename = `page-${index + 1}.mp3`;
  const destination = path.join(outputRoot, filename);
  run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    `${segment.startMs / 1000}`,
    "-to",
    `${segment.endMs / 1000}`,
    "-i",
    input,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "44100",
    "-codec:a",
    "libmp3lame",
    "-q:a",
    "4",
    destination,
    "-y"
  ]);

  const imageFilename = `page-${index + 1}.jpg`;
  const crop = imageCrops[index] ?? cropFromGrid(cropGrid, index, expectedPages);
  const imageUrl = crop
    ? `/media/uploads/${date}/${imageFilename}`
    : `/media/uploads/${date}/cover.jpg`;

  if (crop) {
    run("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      "00:00:01",
      "-i",
      input,
      "-frames:v",
      "1",
      "-vf",
      `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`,
      "-q:v",
      "2",
      path.join(outputRoot, imageFilename),
      "-y"
    ]);
  }

  pages.push({
    order: index + 1,
    type: "word",
    text: words[index] ?? `Page ${index + 1}`,
    audioUrl: `/media/uploads/${date}/${filename}`,
    imageUrl,
    startMs: segment.startMs,
    endMs: segment.endMs,
    sourceSegments: groupedSegments
  });
}

const manifest = {
  date,
  title: "Today's English",
  source: path.resolve(input),
  note: "一个 page 对应一个单词；默认把每个单词的两遍朗读合并成一段音频。发布前请人工复核 text、音频边界、图片裁剪。",
  warnings,
  options: {
    readsPerPage,
    soundPaddingMs,
    words,
    cropGrid,
    imageCrops
  },
  coverImageUrl: `/media/uploads/${date}/cover.jpg`,
  pages
};

await fs.writeFile(path.join(outputRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));

function splitCsv(value: string | undefined) {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function parseRect(value: string | undefined): Rect | undefined {
  if (!value) {
    return undefined;
  }
  const [x, y, width, height] = value.split(",").map((item) => Number(item.trim()));
  if ([x, y, width, height].some((item) => !Number.isFinite(item))) {
    throw new Error(`Invalid crop rectangle: ${value}`);
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function parseRects(value: string | undefined) {
  return value
    ? value
        .split(";")
        .map((item) => item.trim())
        .filter(Boolean)
        .map(parseRect)
        .filter((item): item is Rect => Boolean(item))
    : [];
}

function cropFromGrid(grid: Rect | undefined, index: number, count: number): Rect | undefined {
  if (!grid || count <= 0) {
    return undefined;
  }
  const cellWidth = grid.width / count;
  const x = grid.x + cellWidth * index;
  const nextX = grid.x + cellWidth * (index + 1);
  return {
    x: Math.round(x),
    y: grid.y,
    width: Math.round(nextX - x),
    height: grid.height
  };
}

function groupSegments<T>(items: T[], groupSize: number, expectedGroups: number) {
  if (!Number.isInteger(groupSize) || groupSize < 1) {
    throw new Error("--reads-per-page must be a positive integer");
  }
  const groups: T[][] = [];
  for (let index = 0; index < expectedGroups; index += 1) {
    const start = index * groupSize;
    const group = items.slice(start, start + groupSize);
    if (group.length > 0) {
      groups.push(group);
    }
  }
  return groups;
}
