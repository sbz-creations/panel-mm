import type { NextRequest } from "next/server";
import { activatePicture, VimeoError } from "@/lib/vimeo";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ConfirmBody {
  pic_uri?: string;
  video_id?: string;
  video_name?: string;
  folder_id?: string;
  folder_name?: string;
  timecode?: number;
}

export async function POST(req: NextRequest) {
  let body: ConfirmBody;
  try {
    body = (await req.json()) as ConfirmBody;
  } catch {
    return Response.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  const picUri = typeof body.pic_uri === "string" ? body.pic_uri : "";
  if (!picUri) {
    return Response.json({ detail: "Missing pic_uri" }, { status: 400 });
  }

  try {
    await activatePicture(picUri);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof VimeoError) {
      return Response.json({ detail: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ detail: message }, { status: 500 });
  }
}
