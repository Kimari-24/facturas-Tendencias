import { exigirUsuario } from "@/lib/auth";
import { crearProceso, responderError } from "@/lib/procesos";

export async function POST(request: Request): Promise<Response> {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;
  try {
    return Response.json({ id: await crearProceso(usuario.email) }, { status: 201 });
  } catch (e) {
    return responderError(e);
  }
}
