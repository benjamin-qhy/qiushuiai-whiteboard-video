import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export type TtsDefaultConfig = {
  provider?: string;
  voice?: string;
  rate?: string;
  // 密钥（api_key/token）不在 CONFIG.md，统一走 .env，见 loadEnv()。
  // 这里只放非密钥偏好：声音 id、cluster、语速等。
  volcengine?: {
    speaker?: string;
    spk_id?: string;
    voice_type?: "cloned" | "standard";
    api_resource_id?: string;
    model?: string;
    cluster?: string;
    enable_subtitle?: boolean;
    subtitle_format?: "srt" | "json" | "both";
    audio_format?: "mp3" | "pcm" | "ogg_opus" | "wav";
    sample_rate?: number;
    bit_rate?: number;
    speech_rate?: number;
    loudness_rate?: number;
  };
  fish_audio?: {
    reference_id?: string;
    speed?: number;
    prosody_volume?: number;
    temperature?: number;
    top_p?: number;
    repetition_penalty?: number;
    mp3_bitrate?: number;
    latency?: string;
    normalize?: boolean;
    chunk_length?: number;
  };
  mastering?: {
    enabled?: boolean;
    target_lufs?: number;
    true_peak?: number;
    lra?: number;
  };
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
  const skill = "qiushuiai-tts";
  // 两级：项目级（优先）+ 用户级，与 .env 路径对齐。
  const dirs = [
    join(process.cwd(), ".qiushuiai-skills", skill),
    join(homedir(), ".qiushuiai-skills", skill),
  ];
  const out: string[] = [];
  for (const d of dirs) out.push(join(d, "CONFIG.md"));
  return out;
}

export async function loadDefaultConfig(): Promise<TtsDefaultConfig> {
  for (const loc of configLocations()) {
    try {
      const content = await readFile(loc, "utf-8");
      return parseYamlFrontmatter(content) as TtsDefaultConfig;
    } catch {
      // not found, try next location
    }
  }
  return {};
}

/**
 * 加载 .env 密钥文件，把键值灌进 process.env（不覆盖已存在的）。
 * 优先级：process.env > <cwd>/.qiushuiai-skills/.env > ~/.qiushuiai-skills/.env
 * 密钥（FISH_AUDIO_API_KEY / VOLCENGINE_TTS_TOKEN 等）只从这里来，不进 CONFIG.md。
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
