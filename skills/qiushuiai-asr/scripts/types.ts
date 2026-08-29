export type SubtitleProvider = "edge-tts" | "volcengine" | "fish-audio";

export type CliArgs = {
  audio: string | null;
  text: string | null;
  dict: string | null;
  output: string | null;
  provider: SubtitleProvider | null;
  voice: string | null;
  rate: string | null;
  wordsInCue: number | null;
  maxChars: number | null;
  dropHeadings: boolean;
  json: boolean;
  help: boolean;
};

export type SubtitleEntry = {
  startMs: number;
  endMs: number;
  text: string;
};

export type SubtitleProviderModule = {
  generateSubtitles: (options: SubtitleOptions) => Promise<SubtitleEntry[]>;
};

export type SubtitleOptions = {
  text: string;
  voice?: string;
  rate?: string;
  wordsInCue?: number;
  maxChars?: number;
  audioFile?: string;
  outputPrefix?: string;
};

export type VolcengineWord = {
  text: string;
  start_time: number;
  end_time: number;
  blank_duration?: number;
};

export type VolcengineUtterance = {
  text: string;
  start_time: number;
  end_time: number;
  words: VolcengineWord[];
};
