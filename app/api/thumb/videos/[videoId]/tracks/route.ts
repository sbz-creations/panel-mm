import type { NextRequest } from "next/server";
import { getVideoTracks, VimeoError } from "@/lib/vimeo";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ videoId: string }> },
) {
  try {
    const { videoId } = await ctx.params;
    if (!videoId) {
      return Response.json({ detail: "Missing videoId" }, { status: 400 });
    }
    const tracks = await getVideoTracks(videoId);
    return Response.json({ tracks });
  } catch (err) {
    if (err instanceof VimeoError) {
      return Response.json({ detail: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ detail: message }, { status: 500 });
  }
}
