import { exigirUsuario } from "@/lib/auth";
import { responderError } from "@/lib/procesos";
import { corregirFactura, leerCorreccion } from "@/lib/revision";

export async function POST(request: Request, ctx: RouteContext<"/api/facturas/[hash]/corregir">): Promise<Response> {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;
  try {
    const correccion = leerCorreccion(await request.json().catch(() => null));
    const r = await corregirFactura((await ctx.params).hash, usuario.email, correccion);
    return Response.json(r, { status: r.guardada ? 200 : 422 });
  } catch (e) {
    return responderError(e);
  }
}
