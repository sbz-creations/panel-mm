import { NextRequest } from "next/server";

export const runtime = "nodejs";

const DEFAULTS = {
  output_folder: "",
  anthropic_api_key: "",
  cookies_file: "",
};

export async function GET() {
  return Response.json(DEFAULTS);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return Response.json({ ...DEFAULTS, ...body });
}
