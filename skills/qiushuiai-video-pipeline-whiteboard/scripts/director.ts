import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type Scene = {
  index: number;
  scene_number: number;
  title: string;
  summary: string;
  narration: string;
  description: string;
  visualSetup: string;
  visual_setup: string;
  search_query: string;
  textOverlay: string;
  text_overlay: string;
  key_information: string;
  emotional_beat: string;
  prompt: string;
  start_caption: number;
  end_caption: number;
  start_ms: number;
  end_ms: number;
  beats: Array<{
    beat_number: number;
    start_caption: number;
    end_caption: number;
    start_ms: number;
    end_ms: number;
    visual_addition: string;
    focal_element: string;
    expression: "draw" | "emphasize" | "connect" | "annotate";
  }>;
};

export type Plan = { global_plan: Record<string, unknown>; scenes: Scene[] };
export type TimedCaption = { index: number; startMs: number; endMs: number; text: string };

async function envFile(path: string) {
  try {
    const content = await readFile(path, "utf8");
    return Object.fromEntries(
      content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const i = line.indexOf("=");
          return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, "")];
        }),
    );
  } catch {
    return {};
  }
}

export async function loadEnv() {
  const home = await envFile(join(homedir(), ".qiushuiai-skills/.env"));
  const cwd = await envFile(join(process.cwd(), ".qiushuiai-skills/.env"));
  for (const [key, value] of Object.entries({ ...home, ...cwd })) {
    if (!process.env[key]) process.env[key] = value as string;
  }
}

export async function direct(): Promise<never> {
  throw new Error(
    "Director 已迁移为运行时能力：请由运行时代理使用当前运行时模型生成 scene/分镜计划.json 与 scene/scene-XX/分镜提示词.md，本地脚本不再内置 API 调用。",
  );
}
