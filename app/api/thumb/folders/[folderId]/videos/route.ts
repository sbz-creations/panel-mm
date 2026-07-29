import type { NextRequest } from "next/server";
import { getFolderVideos, VimeoError } from "@/lib/vimeo";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ folderId: string }> },
) {
  try {
    const { folderId } = await ctx.params;
    if (!folderId) {
      return Response.json({ detail: "Missing folderId" }, { status: 400 });
    }
    const videos = await getFolderVideos(folderId);
    return Response.json({ videos });
  } catch (err) {
    if (err instanceof VimeoError) {
      return Response.json({ detail: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ detail: message }, { status: 500 });
  }
}
