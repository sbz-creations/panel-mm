import type { NextRequest } from "next/server";
import { createPicture, pickThumb, VimeoError } from "@/lib/vimeo";

export const runtime = "nodejs";
export const maxDuration = 60;

interface PreviewBody {
  video_id?: string;
  timecode?: number;
}

export async function POST(req: NextRequest) {
  let body: PreviewBody;
  try {
    body = (await req.json()) as PreviewBody;
  } catch {
    return Response.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  const videoId = typeof body.video_id === "string" ? body.video_id : "";
  const timecode = typeof body.timecode === "number" ? body.timecode : NaN;

  if (!videoId) {
    return Response.json({ detail: "Missing video_id" }, { status: 400 });
  }
  if (!Number.isFinite(timecode) || timecode < 0) {
    return Response.json({ detail: "Invalid timecode" }, { status: 400 });
  }

  try {
    const pic = await createPicture(videoId, timecode, false);
    return Response.json({
      pic_uri: pic.uri ?? "",
      thumb_url: pickThumb(pic, 600),
      active: pic.active ?? false,
    });
  } catch (err) {
    if (err instanceof VimeoError) {
      return Response.json({ detail: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ detail: message }, { status: 500 });
  }
}
