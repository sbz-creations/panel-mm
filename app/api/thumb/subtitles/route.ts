import type { NextRequest } from "next/server";
import {
  createTrack,
  deleteTrack,
  getVideoTracks,
  uploadTrackContent,
  VimeoError,
} from "@/lib/vimeo";

export const runtime = "nodejs";
export const maxDuration = 120;

interface SubtitleBody {
  video_id?: string;
  language?: string;
  name?: string;
  srt_content?: string;
}

export async function POST(req: NextRequest) {
  let body: SubtitleBody;
  try {
    body = (await req.json()) as SubtitleBody;
  } catch {
    return Response.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  const videoId = typeof body.video_id === "string" ? body.video_id : "";
  const language = typeof body.language === "string" ? body.language : "";
  const name = typeof body.name === "string" ? body.name : "";
  const srtContent = typeof body.srt_content === "string" ? body.srt_content : "";

  if (!videoId) {
    return Response.json({ detail: "Missing video_id" }, { status: 400 });
  }
  if (!language) {
    return Response.json({ detail: "Missing language" }, { status: 400 });
  }
  if (!srtContent.trim()) {
    return Response.json({ detail: "Missing srt_content" }, { status: 400 });
  }

  try {
    const existing = await getVideoTracks(videoId);
    for (const t of existing) {
      if ((t.language ?? "").toLowerCase() === language.toLowerCase()) {
        await deleteTrack(t.uri);
      }
    }

    const track = await createTrack(videoId, language, name || language);
    const uploadUrl = track.link ?? track.source_link ?? "";
    if (!uploadUrl) {
      return Response.json(
        { detail: `Vimeo no devolvió upload URL. Campos: ${Object.keys(track).join(",")}` },
        { status: 500 },
      );
    }
    await uploadTrackContent(uploadUrl, srtContent);
    return Response.json({ ok: true, track_uri: track.uri ?? "", language });
  } catch (err) {
    if (err instanceof VimeoError) {
      return Response.json({ detail: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ detail: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const trackUri = url.searchParams.get("track_uri") ?? "";
  if (!trackUri) {
    return Response.json({ detail: "Missing track_uri" }, { status: 400 });
  }

  try {
    const ok = await deleteTrack(trackUri);
    if (!ok) {
      return Response.json({ detail: "No se pudo eliminar el track." }, { status: 500 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof VimeoError) {
      return Response.json({ detail: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ detail: message }, { status: 500 });
  }
}
