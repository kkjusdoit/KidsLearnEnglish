import { spawnSync } from "node:child_process";

export type Segment = {
  startMs: number;
  endMs: number;
};

export function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} failed`);
  }
  return `${result.stdout}\n${result.stderr}`;
}

export function detectAudioSegments(input: string) {
  const log = run("ffmpeg", [
    "-hide_banner",
    "-nostats",
    "-i",
    input,
    "-af",
    "silencedetect=noise=-35dB:d=0.25",
    "-f",
    "null",
    "-"
  ]);

  const silenceStarts = [...log.matchAll(/silence_start: ([\d.-]+)/g)].map((match) =>
    Number(match[1])
  );
  const silenceEnds = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((match) =>
    Number(match[1])
  );

  const segments: Segment[] = [];
  for (let index = 0; index < silenceStarts.length; index += 1) {
    const start = silenceEnds[index] ?? 0;
    const end = silenceStarts[index + 1];
    if (end && end - start > 0.25) {
      segments.push({
        startMs: Math.max(0, Math.round(start * 1000)),
        endMs: Math.round(end * 1000)
      });
    }
  }

  return segments;
}
