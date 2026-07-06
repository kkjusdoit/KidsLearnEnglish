import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rawArgs = process.argv.slice(2);
const positional: string[] = [];
const options = new Map<string, string>();
const repoRoot = path.resolve(process.cwd(), "..", "..");

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

const wordsSourceArg = positional[0];
const outputDirArg = positional[1];
const libraryRootArg =
  options.get("library-root") ?? path.join(repoRoot, "work", "audio-libraries", "longman-us");
const format = (options.get("format") ?? "mp3").toLowerCase();

if (!wordsSourceArg || !outputDirArg) {
  console.error(
    [
      "Usage:",
      "  npm run audio:copy-library -w @kindergarten-english/api -- /path/to/words.txt /path/to/output/audio",
      "",
      "Options:",
      "  --library-root /abs/path/to/longman-us",
      "  --format mp3"
    ].join("\n")
  );
  process.exit(1);
}

const wordsSource = path.resolve(wordsSourceArg);
const outputDir = path.resolve(outputDirArg);
const libraryRoot = path.resolve(libraryRootArg);

await main();

async function main() {
  if (format !== "mp3") {
    throw new Error("目前只支持导出 mp3");
  }

  const words = await readWords(wordsSource);
  if (words.length === 0) {
    throw new Error("没有读到任何单词");
  }

  await fs.mkdir(outputDir, { recursive: true });

  const copied: Array<{ word: string; source: string; output: string }> = [];
  const missing: string[] = [];

  for (const word of words) {
    const match = await findLibraryFile(libraryRoot, word);
    if (!match) {
      missing.push(word);
      continue;
    }

    const outputPath = path.join(outputDir, `${safeFileName(word)}.mp3`);
    await convertToMp3(match, outputPath);
    copied.push({
      word,
      source: match,
      output: outputPath
    });
  }

  const summary = {
    ok: missing.length === 0,
    libraryRoot,
    outputDir,
    copied,
    missing
  };

  console.log(JSON.stringify(summary, null, 2));

  if (missing.length > 0) {
    process.exitCode = 2;
  }
}

async function readWords(source: string) {
  const stat = await fs.stat(source);
  if (stat.isDirectory()) {
    return readWords(path.join(source, "words.txt"));
  }

  const content = await fs.readFile(source, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function findLibraryFile(root: string, word: string) {
  const normalized = word.trim();
  const first = firstBucket(normalized);
  const candidates = Array.from(
    new Set([
      path.join(root, first, `${normalized}.mp3`),
      path.join(root, first.toUpperCase(), `${normalized}.mp3`),
      path.join(root, first.toLowerCase(), `${normalized}.mp3`)
    ])
  );

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        return candidate;
      }
    } catch {
      // try next
    }
  }

  return null;
}

function firstBucket(word: string) {
  const first = word[0];
  if (!first) return "0-9";
  return /[A-Za-z]/.test(first) ? first.toUpperCase() : "0-9";
}

function safeFileName(word: string) {
  return word.replace(/[\\/:"*?<>|]+/g, "-");
}

async function convertToMp3(inputPath: string, outputPath: string) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-ac",
      "1",
      "-ar",
      "44100",
      outputPath,
      "-y"
    ],
    { stdio: "pipe" }
  );

  if (result.status !== 0) {
    const stderr = result.stderr?.toString("utf8") ?? "";
    throw new Error(`ffmpeg 转换失败: ${inputPath}\n${stderr}`.trim());
  }
}
