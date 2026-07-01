import path from "node:path";
import { detectAudioSegments } from "./media-utils.js";

const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run media:analyze -w @kindergarten-english/api -- /path/to/video.mp4");
  process.exit(1);
}

const segments = detectAudioSegments(input);

console.log(
  JSON.stringify(
    {
      source: path.resolve(input),
      note: "请人工填写 text/type，并确认每段音频边界后再发布。",
      pages: segments.map((segment, index) => ({
        order: index + 1,
        type: "word",
        text: `Page ${index + 1}`,
        audioUrl: `/media/lessons/YYYY-MM-DD/page-${index + 1}.mp3`,
        ...segment
      }))
    },
    null,
    2
  )
);
