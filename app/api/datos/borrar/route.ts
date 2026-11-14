import { exigirUsuario } from "@/lib/auth";
import { responderError } from "@/lib/procesos";
import { BUCKET, supabaseAdmin } from "@/lib/supabase-admin";

// Restablece el entorno de pruebas del usuario. Exige {"confirmar":"BORRAR"} para evitar borrados accidentales.
export async function POST(request: Request): Promise<Response> {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;
  try {
    const cuerpo = (await request.json().catch(() => ({}))) as { confirmar?: string };
    if (cuerpo.confirmar !== "BORRAR") return Response.json({ error: 'Envía {"confirmar":"BORRAR"}' }, { status: 400 });

    const sb = supabaseAdmin();
    const { data: procesos } = await sb.from("procesos").select("id").eq("usuario", usuario.email);
    const ids = (procesos ?? []).map((p) => p.id as string);
    let imagenes = 0;

    if (ids.length) {
      const { data: facturas } = await sb.from("facturas").select("ruta_imagen").in("proceso_id", ids);
      const rutas = (facturas ?? []).map((f) => f.ruta_imagen as string);
      if (rutas.length) {
        const { error } = await sb.storage.from(BUCKET).remove(rutas);
        if (error) throw error;
        imagenes = rutas.length;
      }
      const { error } = await sb.from("procesos").delete().in("id", ids); // cascade a facturas
      if (error) throw error;
    }

    // Clientes que ya no tienen ninguna factura
    const [{ data: clientes }, { data: usados }] = await Promise.all([
      sb.from("clientes").select("documento"),
      sb.from("facturas").select("documento_cliente").not("documento_cliente", "is", null),
    ]);
    const enUso = new Set((usados ?? []).map((u) => u.documento_cliente as string));
    const huerfanos = (clientes ?? []).map((c) => c.documento as string).filter((d) => !enUso.has(d));
    if (huerfanos.length) await sb.from("clientes").delete().in("documento", huerfanos);

    return Response.json({ procesos: ids.length, imagenes, clientes: huerfanos.length });
  } catch (e) {
    return responderError(e);
  }
}
