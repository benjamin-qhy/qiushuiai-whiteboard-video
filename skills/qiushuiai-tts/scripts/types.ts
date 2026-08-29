export type TtsProvider = "edge-tts" | "volcengine" | "fish-audio";

export type CliArgs = {
  text: string | null;
  file: string | null;
  output: string | null;
  provider: TtsProvider | null;
  voice: string | null;
  rate: string | null;
  volume: string | null;
  pitch: string | null;
  targetLufs: number | null;
  truePeak: number | null;
  lra: number | null;
  noMaster: boolean;
  dropHeadings: boolean;
  enableSubtitle: boolean;
  noSubtitle: boolean;
  subtitleOutput: string | null;
  subtitleSrtOutput: string | null;
  subtitleJsonOutput: string | null;
  subtitleFormat: "srt" | "json" | "both" | null;
  traceOutput: string | null;
  json: boolean;
  listVoices: boolean;
  help: boolean;
};

export type TtsSubtitleWord = {
  text: string;
  start_ms: number;
  end_ms: number;
};

export type TtsSubtitleResult = {
  raw: unknown;
  words?: TtsSubtitleWord[];
};

export type TtsResult = Uint8Array | {
  audio: Uint8Array;
  subtitles?: TtsSubtitleResult;
};

export type TtsProviderModule = {
  getDefaultVoice: () => string;
  generateSpeech: (
    text: string,
    voice: string,
    options: TtsOptions,
  ) => Promise<TtsResult>;
};

export type TtsOptions = {
  rate?: string;
  volume?: string;
  pitch?: string;
  traceOutputPath?: string;
  fishAudio?: {
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
  volcengine?: {
    api_key?: string;
    api_resource_id?: string;
    voice_type?: "cloned" | "standard";
    model?: string;
    enable_subtitle?: boolean;
    audio_format?: "mp3" | "pcm" | "ogg_opus" | "wav";
    sample_rate?: number;
    bit_rate?: number;
    speech_rate?: number;
    loudness_rate?: number;
  };
  mastering?: {
    enabled?: boolean;
    target_lufs?: number;
    true_peak?: number;
    lra?: number;
  };
};
