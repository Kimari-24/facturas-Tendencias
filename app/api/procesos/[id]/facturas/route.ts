import { exigirUsuario } from "@/lib/auth";
import { obtenerProceso, responderError } from "@/lib/procesos";
import { supabaseAdmin } from "@/lib/supabase-admin";

/** Estado de cada factura del lote: la pantalla de carga lo usa para las que procesó el cron del servidor. */
export async function GET(request: Request, ctx: RouteContext<"/api/procesos/[id]/facturas">): Promise<Response> {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;
  try {
    const proceso = await obtenerProceso((await ctx.params).id, usuario.email);
    const { data, error } = await supabaseAdmin()
      .from("facturas")
      .select("hash, estado, numero, proveedor, total, motivos")
      .eq("proceso_id", proceso.id);
    if (error) throw error;
    return Response.json(
      data.map((f) => ({
        hash: f.hash as string,
        estado: f.estado as string,
        numero: f.numero as string | null,
        proveedor: f.proveedor as string | null,
        total: f.total === null ? null : Number(f.total),
        motivo: ((f.motivos as string[] | null) ?? [])[0] ?? null,
      })),
    );
  } catch (e) {
    return responderError(e);
  }
}
