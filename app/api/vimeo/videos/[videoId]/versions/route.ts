import type { NextRequest } from "next/server";
import { createVersion, listVersions, VimeoError } from "@/lib/vimeo";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ videoId: string }> },
) {
  try {
    const { videoId } = await ctx.params;
    if (!videoId || !/^\d+$/.test(videoId)) {
      return Response.json({ detail: "Invalid videoId" }, { status: 400 });
    }
    const versions = await listVersions(videoId);
    return Response.json({ versions });
  } catch (err) {
    if (err instanceof VimeoError) {
      return Response.json({ detail: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ detail: message }, { status: 500 });
  }
}

interface CreateVersionBody {
  file_name?: unknown;
  file_size?: unknown;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ videoId: string }> },
) {
  try {
    const { videoId } = await ctx.params;
    if (!videoId || !/^\d+$/.test(videoId)) {
      return Response.json({ detail: "Invalid videoId" }, { status: 400 });
    }
    const body = (await req.json().catch(() => ({}))) as CreateVersionBody;
    const fileName = typeof body.file_name === "string" ? body.file_name.trim() : "";
    const fileSize = typeof body.file_size === "number" ? body.file_size : Number(body.file_size);

    if (!fileName) {
      return Response.json({ detail: "file_name is required" }, { status: 400 });
    }
    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      return Response.json({ detail: "file_size must be a positive number" }, { status: 400 });
    }

    const ticket = await createVersion(videoId, fileName, fileSize);
    return Response.json(ticket);
  } catch (err) {
    if (err instanceof VimeoError) {
      return Response.json({ detail: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ detail: message }, { status: 500 });
  }
}
