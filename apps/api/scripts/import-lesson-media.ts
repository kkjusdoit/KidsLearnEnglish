import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../src/config.js";
import { query, closeDb } from "../src/db.js";
import { migrate } from "../src/schema.js";

type ManifestPage = {
  order?: number;
  type?: "word" | "sentence";
  text: string;
  audio?: string;
  image?: string | null;
  startMs?: number | null;
  endMs?: number | null;
};

type Manifest = {
  date?: string;
  title?: string;
  status?: "draft" | "published";
  words?: string[];
  pages?: ManifestPage[];
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

const sourceDirArg = positional[0];
if (!sourceDirArg) {
  console.error(
    [
      "Usage:",
      "  npm run media:import -w @kindergarten-english/api -- /path/to/source-dir 2026-07-03",
      "",
      "Directory layout:",
      "  page-1.jpg  page-1.mp3",
      "  page-2.jpg  page-2.mp3",
      "  words.txt or manifest.json",
      "",
      "Or simplified layout:",
      "  20260703/",
      "    audio/1.mp3  audio/2.mp3",
      "    image/1.jpg  image/2.jpg",
      "    words.txt",
      "",
      "Options:",
      "  --words crayon,paper,pencil",
      "  --title \"2026-07-03 English\"",
      "  --status published"
    ].join("\n")
  );
  process.exit(1);
}

const sourceDir = path.resolve(sourceDirArg);
await main().finally(closeDb);

async function main() {
  const manifest = await readManifest(sourceDir);
  const date =
    normalizeLessonDate(positional[1]) ??
    normalizeLessonDate(options.get("date")) ??
    normalizeLessonDate(manifest?.date) ??
    inferDateFromDirectory(sourceDir) ??
    new Date().toISOString().slice(0, 10);
  const title = options.get("title") ?? manifest?.title ?? `${date} English`;
  const status = parseStatus(options.get("status") ?? manifest?.status ?? "published");
  const outputDir = path.join(config.localStorageDir, "uploads", date);
  const cliWords = splitCsv(options.get("words"));

  await migrate();
  await fs.mkdir(outputDir, { recursive: true });

  const pages = manifest?.pages?.length
    ? await importManifestPages({ sourceDir, outputDir, date, pages: manifest.pages })
    : await importNumberedPages({
        sourceDir,
        outputDir,
        date,
        words: cliWords.length ? cliWords : await resolveWords(sourceDir, manifest)
      });

  if (pages.length === 0) {
    throw new Error("没有找到可导入的页面");
  }

  const lesson = await query<{ id: string }>(
    `
      insert into lessons (lesson_date, title, status)
      values ($1, $2, $3)
      on conflict (lesson_date)
      do update set title = excluded.title, status = excluded.status
      returning id
    `,
    [date, title, status]
  );

  const lessonId = lesson.rows[0]?.id;
  if (!lessonId) {
    throw new Error("课程创建失败");
  }

  await query("delete from lesson_pages where lesson_id = $1", [lessonId]);

  for (const page of pages) {
    await query(
      `
        insert into lesson_pages
          (lesson_id, page_order, page_type, text, audio_url, image_url, start_ms, end_ms)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        lessonId,
        page.order,
        page.type,
        page.text,
        page.audioUrl,
        page.imageUrl ?? null,
        page.startMs ?? null,
        page.endMs ?? null
      ]
    );
  }

  const summary = {
    ok: true,
    lessonId,
    date,
    title,
    status,
    outputDir,
    pages
  };

  console.log(JSON.stringify(summary, null, 2));
}

type ImportedPage = {
  order: number;
  type: "word" | "sentence";
  text: string;
  audioUrl: string;
  imageUrl: string | null;
  startMs?: number | null;
  endMs?: number | null;
};

async function readManifest(dir: string) {
  const manifestPath = path.join(dir, "manifest.json");
  try {
    const content = await fs.readFile(manifestPath, "utf8");
    return JSON.parse(content) as Manifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function resolveWords(dir: string, manifest: Manifest | null) {
  if (manifest?.words?.length) {
    return manifest.words;
  }

  const wordsPath = path.join(dir, "words.txt");
  try {
    const content = await fs.readFile(wordsPath, "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("缺少 words.txt、manifest.json pages，或 --words 参数");
    }
    throw error;
  }
}

async function importNumberedPages(params: {
  sourceDir: string;
  outputDir: string;
  date: string;
  words: string[];
}) {
  const { sourceDir, outputDir, date, words } = params;
  const pages: ImportedPage[] = [];

  for (const [index, text] of words.entries()) {
    const order = index + 1;
    const audioFile = await findAssetForOrder(sourceDir, order, "audio");
    if (!audioFile) {
      throw new Error(`缺少第 ${order} 页音频文件`);
    }

    const imageFile = await findAssetForOrder(sourceDir, order, "image");
    const audioTarget = await copyAsset({
      sourceDir,
      outputDir,
      sourceName: audioFile,
      targetBase: `page-${order}`
    });
    const imageTarget = imageFile
      ? await copyAsset({
          sourceDir,
          outputDir,
          sourceName: imageFile,
          targetBase: `page-${order}`
        })
      : null;

    pages.push({
      order,
      type: "word",
      text,
      audioUrl: `/media/uploads/${date}/${audioTarget}`,
      imageUrl: imageTarget ? `/media/uploads/${date}/${imageTarget}` : null
    });
  }

  return pages;
}

async function importManifestPages(params: {
  sourceDir: string;
  outputDir: string;
  date: string;
  pages: ManifestPage[];
}) {
  const { sourceDir, outputDir, date } = params;
  const sortedPages = [...params.pages].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  const pages: ImportedPage[] = [];

  for (const [index, page] of sortedPages.entries()) {
    const order = page.order ?? index + 1;
    const text = page.text?.trim();
    if (!text) {
      throw new Error(`第 ${order} 页缺少 text`);
    }

    const audioSource =
      page.audio ?? (await findAssetForOrder(sourceDir, order, "audio"));
    if (!audioSource) {
      throw new Error(`第 ${order} 页缺少音频文件`);
    }

    const imageSource =
      page.image === null
        ? null
        : page.image ?? (await findAssetForOrder(sourceDir, order, "image"));

    const audioTarget = await copyAsset({
      sourceDir,
      outputDir,
      sourceName: audioSource,
      targetBase: `page-${order}`
    });
    const imageTarget = imageSource
      ? await copyAsset({
          sourceDir,
          outputDir,
          sourceName: imageSource,
          targetBase: `page-${order}`
        })
      : null;

    pages.push({
      order,
      type: page.type ?? "word",
      text,
      audioUrl: `/media/uploads/${date}/${audioTarget}`,
      imageUrl: imageTarget ? `/media/uploads/${date}/${imageTarget}` : null,
      startMs: page.startMs ?? null,
      endMs: page.endMs ?? null
    });
  }

  return pages;
}

async function copyAsset(params: {
  sourceDir: string;
  outputDir: string;
  sourceName: string;
  targetBase: string;
}) {
  const extension = path.extname(params.sourceName).toLowerCase();
  const targetName = `${params.targetBase}${extension}`;
  await fs.copyFile(
    path.join(params.sourceDir, params.sourceName),
    path.join(params.outputDir, targetName)
  );
  return targetName;
}

function splitCsv(value: string | undefined) {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function parseStatus(value: string) {
  if (value !== "draft" && value !== "published") {
    throw new Error(`无效 status: ${value}`);
  }
  return value;
}

async function findAssetForOrder(sourceDir: string, order: number, kind: "audio" | "image") {
  const extensions = kind === "audio" ? AUDIO_EXTENSIONS : IMAGE_EXTENSIONS;
  const folders = kind === "audio" ? ["", "audio"] : ["", "image"];
  const basenames = [`page-${order}`, `${order}`];

  for (const folder of folders) {
    for (const basename of basenames) {
      for (const extension of extensions) {
        const relativePath = folder ? path.join(folder, `${basename}${extension}`) : `${basename}${extension}`;
        if (await pathExists(path.join(sourceDir, relativePath))) {
          return relativePath;
        }
      }
    }
  }

  return null;
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeLessonDate(value: string | undefined) {
  if (!value) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  return null;
}

function inferDateFromDirectory(dir: string) {
  return normalizeLessonDate(path.basename(dir));
}

const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".wav", ".aac", ".webm", ".ogg"] as const;
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"] as const;
