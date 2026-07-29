export const runtime = "nodejs";

export async function POST() {
  return Response.json(
    { detail: "La transcripción por path solo está disponible en la versión local." },
    { status: 501 },
  );
}
