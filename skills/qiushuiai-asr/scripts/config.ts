import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export type AsrDefaultConfig = {
  provider?: string;
  voice?: string;
  dict?: string;
  words_in_cue?: number;
  max_chars?: number;
  // 密钥（VOLCENGINE_TTS_TOKEN / FISH_AUDIO_API_KEY）不在 CONFIG.md，统一走 .env，见 loadEnv()。
};

function parseValue(value: string): unknown {
  if (value === "" || value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  const num = Number(value);
  if (!isNaN(num) && value !== "") return num;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let currentObject: Record<string, unknown> | null = null;
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (value === "") {
        currentObject = {};
        result[key] = currentObject;
      } else {
        currentObject = null;
        result[key] = parseValue(value);
      }
    } else if (currentObject !== null) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      currentObject[key] = parseValue(value);
    }
  }
  return result;
}

function parseYamlFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  return parseSimpleYaml(match[1]);
}

function configLocations(): string[] {
  const skill = "qiushuiai-asr";
  const names = ["CONFIG.md", "default-config.md"];
  // 两级：项目级（优先）+ 用户级，与 .env 路径对齐。
  const dirs = [
    join(process.cwd(), ".qiushuiai-skills", skill),
    join(homedir(), ".qiushuiai-skills", skill),
  ];
  const out: string[] = [];
  for (const d of dirs) for (const n of names) out.push(join(d, n));
  return out;
}

export async function loadDefaultConfig(): Promise<AsrDefaultConfig> {
  for (const loc of configLocations()) {
    try {
      const content = await readFile(loc, "utf-8");
      return parseYamlFrontmatter(content) as AsrDefaultConfig;
    } catch {
      // not found, try next location
    }
  }
  return {};
}

/**
 * 加载 .env 密钥文件，把键值灌进 process.env（不覆盖已存在的）。
 * 优先级：process.env > <cwd>/.qiushuiai-skills/.env > ~/.qiushuiai-skills/.env
 * 密钥（VOLCENGINE_TTS_TOKEN / FISH_AUDIO_API_KEY 等）只从这里来，不进 CONFIG.md。
 */
async function loadEnvFile(p: string): Promise<Record<string, string>> {
  try {
    const content = await readFile(p, "utf-8");
    const env: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
    return env;
  } catch {
    return {};
  }
}

export async function loadEnv(): Promise<void> {
  const homeEnv = await loadEnvFile(join(homedir(), ".qiushuiai-skills", ".env"));
  const cwdEnv = await loadEnvFile(join(process.cwd(), ".qiushuiai-skills", ".env"));
  // 项目级覆盖用户级；两者都不覆盖已存在的 process.env。
  const merged = { ...homeEnv, ...cwdEnv };
  for (const [k, v] of Object.entries(merged)) {
    if (!process.env[k]) process.env[k] = v;
  }
}
