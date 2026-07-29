import { NextRequest } from "next/server";
import {
  LANGUAGES,
  buildSrt,
  googleTranslate,
  parseSrt,
  type LanguageCode,
} from "@/lib/translate-google";

export const runtime = "nodejs";
export const maxDuration = 60;

interface TranslateBody {
  srt?: string;
  target_languages?: string[];
  model?: string;
  api_key?: string;
  context?: string;
}

export async function POST(req: NextRequest) {
  let body: TranslateBody;
  try {
    body = (await req.json()) as TranslateBody;
  } catch {
    return Response.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  const srt = typeof body.srt === "string" ? body.srt : "";
  const targets = Array.isArray(body.target_languages) ? body.target_languages : [];

  if (!srt.trim()) {
    return Response.json({ detail: "Missing srt" }, { status: 400 });
  }
  if (targets.length === 0) {
    return Response.json({ detail: "Missing target_languages" }, { status: 400 });
  }
  for (const lang of targets) {
    if (!(lang in LANGUAGES)) {
      return Response.json(
        { detail: `Unsupported language: ${lang}` },
        { status: 400 },
      );
    }
  }

  const blocks = parseSrt(srt);
  const texts = blocks.map((b) => b.text);
  const translations: Record<string, string> = {};

  for (const lang of targets as LanguageCode[]) {
    try {
      const translated = await googleTranslate(texts, lang);
      const outBlocks = blocks.map((b, i) => ({
        ...b,
        text: translated[i] ?? b.text,
      }));
      translations[lang] = buildSrt(outBlocks);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json(
        { detail: `[${lang}] ${message}` },
        { status: 500 },
      );
    }
  }

  return Response.json({ translations });
}
