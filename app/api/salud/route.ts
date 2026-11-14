import { connection } from "next/server";

export async function GET(): Promise<Response> {
  await connection(); // dinámico: hora real en cada petición
  return Response.json({ ok: true, hora: new Date().toISOString() });
}
