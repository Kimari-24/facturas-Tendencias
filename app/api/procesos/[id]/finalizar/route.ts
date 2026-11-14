import { exigirUsuario } from "@/lib/auth";
import { finalizarProceso, obtenerProceso, responderError } from "@/lib/procesos";

export async function POST(request: Request, ctx: RouteContext<"/api/procesos/[id]/finalizar">): Promise<Response> {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;
  try {
    const proceso = await obtenerProceso((await ctx.params).id, usuario.email);
    return Response.json(await finalizarProceso(proceso));
  } catch (e) {
    return responderError(e);
  }
}
