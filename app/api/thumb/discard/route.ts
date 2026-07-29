import type { NextRequest } from "next/server";
import { deletePicture, VimeoError } from "@/lib/vimeo";

export const runtime = "nodejs";
export const maxDuration = 60;

interface DiscardBody {
  pic_uri?: string;
}

export async function POST(req: NextRequest) {
  let body: DiscardBody;
  try {
    body = (await req.json()) as DiscardBody;
  } catch {
    return Response.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  const picUri = typeof body.pic_uri === "string" ? body.pic_uri : "";
  if (!picUri) {
    return Response.json({ detail: "Missing pic_uri" }, { status: 400 });
  }

  try {
    await deletePicture(picUri);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof VimeoError) {
      return Response.json({ detail: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ detail: message }, { status: 500 });
  }
}
