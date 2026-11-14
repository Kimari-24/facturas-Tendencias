import { exigirUsuario } from "@/lib/auth";
import { obtenerProceso, procesarLote, responderError } from "@/lib/procesos";

export const maxDuration = 60; // 2 facturas × hasta 3 intentos de OCR + arranque en frío

export async function POST(request: Request, ctx: RouteContext<"/api/procesos/[id]/lote">): Promise<Response> {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;
  try {
    const proceso = await obtenerProceso((await ctx.params).id, usuario.email);
    return Response.json(await procesarLote(proceso));
  } catch (e) {
    return responderError(e);
  }
}
