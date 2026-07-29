const API_URL = "/api";

export interface HistoryJob {
  id: number;
  filename: string;
  type: "srt" | "video";
  languages: string[];
  model: string;
  status: "done" | "error";
  created_at: string;
}

export async function getHistory(): Promise<HistoryJob[]> {
  const res = await fetch(`${API_URL}/history`);
  if (!res.ok) return [];
  return res.json();
}

export async function saveJob(
  job: Omit<HistoryJob, "id" | "created_at">
): Promise<HistoryJob> {
  const res = await fetch(`${API_URL}/history`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(job),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? res.statusText);
  }
  return res.json();
}

export interface AppConfig {
  output_folder: string;
  anthropic_api_key: string;
  cookies_file: string;
}

export async function getConfig(): Promise<AppConfig> {
  const res = await fetch(`${API_URL}/config`);
  if (!res.ok) return { output_folder: "", anthropic_api_key: "", cookies_file: "" };
  return res.json();
}

export async function saveConfig(payload: Partial<AppConfig>): Promise<AppConfig> {
  const res = await fetch(`${API_URL}/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ output_folder: "", anthropic_api_key: "", cookies_file: "", ...payload }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? res.statusText);
  }
  return res.json();
}

export interface InsertSuggestion {
  timecode: string;
  type: "player" | "club" | "visual";
  text: string;
  suggestion: string;
}

export async function analyzeInserts(srt: string): Promise<InsertSuggestion[]> {
  const res = await fetch(`${API_URL}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ srt }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.inserts ?? [];
}

export async function saveFile(filename: string, content: string): Promise<{ path: string }> {
  const res = await fetch(`${API_URL}/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, content }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? res.statusText);
  }
  return res.json();
}

export type ProgressStatus = "loading_model" | "transcribing" | "translating" | "done" | "downloading";

export interface ProgressUpdate {
  status: ProgressStatus;
  percent: number;
}

export async function transcribeFile(
  file: File,
  modelSize: string,
  language: string,
  onProgress: (update: ProgressUpdate) => void,
  onLanguageDetected?: (lang: string) => void
): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("model_size", modelSize);
  formData.append("language", language);

  const response = await fetch(`${API_URL}/transcribe`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Transcription failed: ${response.statusText}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let srt = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let parsed: Record<string, string>;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }

      if (parsed.status === "loading_model") {
        onProgress({ status: "loading_model", percent: Number(parsed.percent) || 10 });
      } else if (parsed.status === "transcribing") {
        onProgress({ status: "transcribing", percent: Number(parsed.percent) || 60 });
      } else if (parsed.status === "done") {
        srt = parsed.srt ?? "";
        if (parsed.language) onLanguageDetected?.(parsed.language);
        onProgress({ status: "done", percent: 100 });
      } else if (parsed.status === "error") {
        throw new Error(parsed.message ?? "Transcription error");
      }
    }
  }

  return srt;
}

export async function transcribeFromPath(
  path: string,
  language: string,
  onProgress: (update: ProgressUpdate) => void
): Promise<string> {
  const response = await fetch(`${API_URL}/transcribe/path`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, language, model_size: "large-v3" }),
  });

  if (!response.ok) {
    throw new Error(`Transcription failed: ${response.statusText}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let srt = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (parsed.status === "loading_model") {
        onProgress({ status: "loading_model", percent: Number(parsed.percent) || 10 });
      } else if (parsed.status === "transcribing") {
        onProgress({ status: "transcribing", percent: Number(parsed.percent) || 60 });
      } else if (parsed.status === "done") {
        srt = String(parsed.srt ?? "");
        onProgress({ status: "done", percent: 100 });
      } else if (parsed.status === "error") {
        throw new Error(String(parsed.message ?? "Transcription error"));
      }
    }
  }
  return srt;
}

export async function transcribeFromUrl(
  url: string,
  language: string,
  onProgress: (update: ProgressUpdate) => void,
  onLanguageDetected?: (lang: string) => void
): Promise<string> {
  const response = await fetch(`${API_URL}/transcribe/url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, language, model_size: "large-v3" }),
  });

  if (!response.ok) {
    throw new Error(`Transcription failed: ${response.statusText}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let srt = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (parsed.status === "downloading") {
        onProgress({ status: "downloading", percent: Number(parsed.percent) || 10 });
      } else if (parsed.status === "loading_model") {
        onProgress({ status: "loading_model", percent: Number(parsed.percent) || 40 });
      } else if (parsed.status === "transcribing") {
        onProgress({ status: "transcribing", percent: Number(parsed.percent) || 70 });
      } else if (parsed.status === "done") {
        srt = String(parsed.srt ?? "");
        if (parsed.language) onLanguageDetected?.(String(parsed.language));
        onProgress({ status: "done", percent: 100 });
      } else if (parsed.status === "error") {
        throw new Error(String(parsed.message ?? "Transcription error"));
      }
    }
  }
  return srt;
}

async function translateTitle(title: string, targetLang: string): Promise<string> {
  const url =
    `https://translate.googleapis.com/translate_a/single` +
    `?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(title)}`;
  const res = await fetch(url);
  if (!res.ok) return title;
  const data = await res.json();
  return (data[0] as [string][]).map((part) => part[0]).join("") || title;
}

export function prependTitleBlock(srt: string, translatedTitle: string, durationSecs: number = 4): string {
  const ms = durationSecs * 1000;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msRem = ms % 1000;
  const endTs = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(msRem).padStart(3, "0")}`;
  const titleBlock = `0\n00:00:00,000 --> ${endTs}\n${translatedTitle}`;
  const reindexed = srt.trim().replace(/^(\d+)(?=\n)/gm, (_, n) => String(parseInt(n, 10) + 1));
  return `${titleBlock}\n\n${reindexed}`;
}

export async function translateSrt(
  srt: string,
  targetLanguages: string[],
  title?: string,
  titleDuration: number = 4
): Promise<Record<string, string>> {
  const response = await fetch(`${API_URL}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      srt,
      target_languages: targetLanguages.map((l) => l.toLowerCase()),
      model: "google",
      api_key: "",
      context: "",
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(`Translation failed: ${body?.detail ?? response.statusText}`);
  }

  const data = await response.json();
  const translations = data.translations as Record<string, string>;

  if (!title) return translations;

  const result: Record<string, string> = {};
  for (const lang of targetLanguages) {
    const key = lang.toLowerCase();
    const translated = translations[key];
    if (!translated || typeof translated !== "string") {
      result[key] = typeof translated === "string" ? translated : "";
      continue;
    }
    const translatedTitle = await translateTitle(title, key);
    result[key] = prependTitleBlock(translated, translatedTitle, titleDuration);
  }
  return result;
}
