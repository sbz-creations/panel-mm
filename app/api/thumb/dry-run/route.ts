import type { NextRequest } from "next/server";
import { getFolderVideos, VimeoError } from "@/lib/vimeo";

export const runtime = "nodejs";
export const maxDuration = 60;

interface DryRunBody {
  folder_id?: string;
  timecode?: number;
}

export async function POST(req: NextRequest) {
  let body: DryRunBody;
  try {
    body = (await req.json()) as DryRunBody;
  } catch {
    return Response.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  const folderId = typeof body.folder_id === "string" ? body.folder_id : "";
  const timecode = typeof body.timecode === "number" ? body.timecode : NaN;
  if (!folderId) {
    return Response.json({ detail: "Missing folder_id" }, { status: 400 });
  }
  if (!Number.isFinite(timecode) || timecode < 0) {
    return Response.json({ detail: "Invalid timecode" }, { status: 400 });
  }

  try {
    const videos = await getFolderVideos(folderId);
    const items = videos.map((v) => {
      if (v.transcode_status !== "complete") {
        return { ...v, action: "skip" as const, reason: `transcode: ${v.transcode_status}` };
      }
      if (v.duration < timecode) {
        return { ...v, action: "skip" as const, reason: `dura ${v.duration}s < ${timecode}s` };
      }
      return { ...v, action: "apply" as const, reason: null };
    });
    return Response.json({ items });
  } catch (err) {
    if (err instanceof VimeoError) {
      return Response.json({ detail: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ detail: message }, { status: 500 });
  }
}
