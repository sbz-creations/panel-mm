import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { filename?: string };
  return Response.json({ path: body.filename ?? "" });
}
