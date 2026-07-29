export const LANGUAGES = {
  en: "English",
  pt: "Portuguese",
  fr: "French",
  de: "German",
  it: "Italian",
  jp: "Japanese",
} as const;

export type LanguageCode = keyof typeof LANGUAGES;

export interface SrtBlock {
  index: string;
  time: string;
  text: string;
}

export function parseSrt(srt: string): SrtBlock[] {
  const blocks: SrtBlock[] = [];
  for (const raw of srt.trim().split(/\r?\n\r?\n/)) {
    const lines = raw.trim().split(/\r?\n/);
    if (lines.length >= 3) {
      blocks.push({
        index: lines[0],
        time: lines[1],
        text: lines.slice(2).join("\n"),
      });
    }
  }
  return blocks;
}

export function buildSrt(blocks: SrtBlock[]): string {
  return blocks.map((b) => `${b.index}\n${b.time}\n${b.text}`).join("\n\n");
}

function makeChunks(
  items: Array<[number, string]>,
  maxChars = 4000,
): Array<Array<[number, string]>> {
  const chunks: Array<Array<[number, string]>> = [];
  let current: Array<[number, string]> = [];
  let currentLen = 0;
  for (const [i, text] of items) {
    const entryLen = `${i + 1}. ${text}\n`.length;
    if (current.length && currentLen + entryLen > maxChars) {
      chunks.push(current);
      current = [];
      currentLen = 0;
    }
    current.push([i, text]);
    currentLen += entryLen;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function googleTranslate(
  texts: string[],
  targetLang: LanguageCode,
): Promise<string[]> {
  const lines: Array<[number, string]> = [];
  const blockMap: Array<[number, number]> = [];
  for (const text of texts) {
    const blockLines = text.split("\n");
    blockMap.push([lines.length, blockLines.length]);
    for (const line of blockLines) lines.push([lines.length, line]);
  }

  const resultsMap = new Map<number, string>();

  for (const chunk of makeChunks(lines)) {
    const numbered = chunk.map(([, t], j) => `${j + 1}. ${t}`).join("\n");
    const url =
      "https://translate.googleapis.com/translate_a/single" +
      `?client=gtx&sl=es&tl=${targetLang}&dt=t&q=${encodeURIComponent(numbered)}`;

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) throw new Error(`Google Translate HTTP ${res.status}`);
    const data = (await res.json()) as unknown;

    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      throw new Error("Unexpected Google Translate response shape");
    }
    const translated = (data[0] as unknown[])
      .map((part) => (Array.isArray(part) && typeof part[0] === "string" ? part[0] : ""))
      .join("");

    const mapping = new Map<number, string>();
    for (const line of translated.split("\n")) {
      const m = /^(\d+)\.\s*(.*)/.exec(line.trim());
      if (m) mapping.set(parseInt(m[1], 10) - 1, m[2].trim());
    }

    chunk.forEach(([origIdx, origLine], j) => {
      resultsMap.set(origIdx, mapping.get(j) ?? origLine);
    });

    await sleep(120);
  }

  const translatedLines = lines.map(
    ([i, original]) => resultsMap.get(i) ?? original,
  );

  return blockMap.map(([start, count]) =>
    translatedLines.slice(start, start + count).join("\n"),
  );
}
