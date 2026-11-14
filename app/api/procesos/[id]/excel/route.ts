import { exigirUsuario } from "@/lib/auth";
import { generarExcel } from "@/lib/excel";
import { obtenerProceso, responderError } from "@/lib/procesos";

// Se genera en cada descarga: siempre refleja correcciones manuales y no ocupa Storage.
export async function GET(request: Request, ctx: RouteContext<"/api/procesos/[id]/excel">): Promise<Response> {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;
  try {
    const proceso = await obtenerProceso((await ctx.params).id, usuario.email);
    const { nombre, bytes } = await generarExcel(proceso.id);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${nombre}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    return responderError(e);
  }
}
