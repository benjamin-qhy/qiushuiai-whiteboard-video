import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type Config = { sam_api_url?: string; background_image?: string };

function scalar(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

export async function loadConfig(): Promise<Config> {
  const paths = [
    join(process.cwd(), ".qiushuiai-skills/qiushuiai-video-pipeline-whiteboard/CONFIG.md"),
    join(homedir(), ".qiushuiai-skills/qiushuiai-video-pipeline-whiteboard/CONFIG.md"),
  ];
  for (const path of paths) {
    try {
      const content = await readFile(path, "utf8");
      const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!frontmatter) return {};
      const entries = frontmatter[1].split(/\r?\n/).map((line) => line.match(/^([a-z_]+):\s*(.+)$/)).filter(Boolean).map((match) => [match![1], scalar(match![2])]);
      return Object.fromEntries(entries);
    } catch {}
  }
  return {};
}
