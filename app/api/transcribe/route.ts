export const runtime = "nodejs";

export async function POST() {
  return Response.json(
    { detail: "La transcripción solo está disponible en la versión local." },
    { status: 501 },
  );
}
