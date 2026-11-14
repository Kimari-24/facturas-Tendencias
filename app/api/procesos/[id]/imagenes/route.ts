import { exigirUsuario } from "@/lib/auth";
import { ErrorHttp, MAX_BYTES, obtenerProceso, responderError, subirImagen } from "@/lib/procesos";

// Una imagen por petición, bytes crudos en el body (sin multipart).
export async function POST(request: Request, ctx: RouteContext<"/api/procesos/[id]/imagenes">): Promise<Response> {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;
  try {
    const largo = Number(request.headers.get("content-length") ?? 0);
    if (largo > MAX_BYTES) throw new ErrorHttp(413, "Imagen mayor a 4 MB");
    const proceso = await obtenerProceso((await ctx.params).id, usuario.email);
    const resultado = await subirImagen(proceso, Buffer.from(await request.arrayBuffer()));
    return Response.json(resultado, { status: resultado.duplicada ? 200 : 201 });
  } catch (e) {
    return responderError(e);
  }
}
