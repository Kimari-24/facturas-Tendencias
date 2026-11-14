import { createHash, timingSafeEqual } from "node:crypto";
import { procesarCola, responderError } from "@/lib/procesos";

// La llama Supabase (pg_cron + pg_net) cada minuto. No usa sesión de usuario: se protege con un secreto
// compartido (COLA_SECRETO en Vercel y en la tabla config_cola de Supabase).
export const maxDuration = 60;

function autorizado(request: Request): boolean {
  const secreto = process.env.COLA_SECRETO ?? "";
  if (secreto.length < 32) return false; // sin secreto configurado, la ruta queda cerrada
  const recibido = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  // Comparar resúmenes de igual largo en tiempo constante (no filtra el secreto por tiempos)
  const h = (v: string): Buffer => createHash("sha256").update(v).digest();
  return timingSafeEqual(h(recibido), h(secreto));
}

export async function POST(request: Request): Promise<Response> {
  if (!autorizado(request)) return Response.json({ error: "No autorizado" }, { status: 401 });
  try {
    return Response.json(await procesarCola());
  } catch (e) {
    return responderError(e);
  }
}
