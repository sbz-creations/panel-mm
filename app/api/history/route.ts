import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return Response.json([]);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return Response.json({
    id: Date.now(),
    created_at: new Date().toISOString(),
    ...body,
  });
}
