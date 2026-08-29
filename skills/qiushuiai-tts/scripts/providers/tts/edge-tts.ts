import { readFile, writeFile, unlink } from "fs/promises";
import type { TtsOptions } from "../../types";

export function getDefaultVoice(): string {
  return "zh-CN-YunxiNeural";
}

export async function generateSpeech(
  text: string,
  voice: string,
  options: TtsOptions
): Promise<Uint8Array> {
  const tmp = `/tmp/tts-input-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  const tmpMp3 = `/tmp/tts-output-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`;

  try {
    await writeFile(tmp, text, "utf-8");

    const args = [
      "--file",
      tmp,
      "--voice",
      voice,
      "--write-media",
      tmpMp3,
    ];

    if (options.rate) {
      args.push("--rate", options.rate);
    }
    if (options.volume) {
      args.push("--volume", options.volume);
    }
    if (options.pitch) {
      args.push("--pitch", options.pitch);
    }

    const proc = Bun.spawn(["edge-tts", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    // Drain streams concurrently to keep event loop alive and prevent deadlock
    const drainStdout = Bun.readableStreamToText(proc.stdout).catch(() => "");
    const drainStderr = Bun.readableStreamToText(proc.stderr).catch(() => "");
    const [exitCode, , stderr] = await Promise.all([proc.exited, drainStdout, drainStderr]);
    if (exitCode !== 0) {
      throw new Error(`edge-tts failed (exit ${exitCode}): ${stderr}`);
    }

    const audio = await readFile(tmpMp3);
    return new Uint8Array(audio);
  } finally {
    await unlink(tmp).catch(() => {});
    await unlink(tmpMp3).catch(() => {});
  }
}
