import { exigirUsuario } from "@/lib/auth";
import { responderError } from "@/lib/procesos";
import { BUCKET, supabaseAdmin } from "@/lib/supabase-admin";

const PAGINA = 1000; // Supabase devuelve como máximo 1000 filas por consulta

/** Lee todas las filas de una consulta, página por página (sin esto se pierde todo lo que pase de 1000). */
async function todas<T>(pagina: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await pagina(desde, desde + PAGINA - 1);
    if (error) throw error;
    filas.push(...(data ?? []));
    if ((data ?? []).length < PAGINA) return filas;
  }
}

// Restablece el entorno de pruebas del usuario. Exige {"confirmar":"BORRAR"} para evitar borrados accidentales.
export async function POST(request: Request): Promise<Response> {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;
  try {
    const cuerpo = (await request.json().catch(() => ({}))) as { confirmar?: string };
    if (cuerpo.confirmar !== "BORRAR") return Response.json({ error: 'Envía {"confirmar":"BORRAR"}' }, { status: 400 });

    const sb = supabaseAdmin();
    const procesos = await todas<{ id: string }>((a, b) => sb.from("procesos").select("id").eq("usuario", usuario.email).order("id").range(a, b));
    const ids = procesos.map((p) => p.id);
    let imagenes = 0;

    // Por tandas: la lista de ids va en la URL de la consulta
    for (let i = 0; i < ids.length; i += 100) {
      const tanda = ids.slice(i, i + 100);
      const facturas = await todas<{ ruta_imagen: string }>((a, b) =>
        sb.from("facturas").select("ruta_imagen").in("proceso_id", tanda).order("hash").range(a, b),
      );
      for (let j = 0; j < facturas.length; j += PAGINA) {
        const { error } = await sb.storage.from(BUCKET).remove(facturas.slice(j, j + PAGINA).map((f) => f.ruta_imagen));
        if (error) throw error;
      }
      imagenes += facturas.length;
      const { error } = await sb.from("procesos").delete().in("id", tanda); // cascade a facturas
      if (error) throw error;
    }

    // Clientes que ya no tienen ninguna factura
    const [clientes, usados] = await Promise.all([
      todas<{ documento: string }>((a, b) => sb.from("clientes").select("documento").order("documento").range(a, b)),
      todas<{ documento_cliente: string }>((a, b) =>
        sb.from("facturas").select("documento_cliente").not("documento_cliente", "is", null).order("hash").range(a, b),
      ),
    ]);
    const enUso = new Set(usados.map((u) => u.documento_cliente));
    const huerfanos = clientes.map((c) => c.documento).filter((d) => !enUso.has(d));
    for (let i = 0; i < huerfanos.length; i += 100) {
      const { error } = await sb.from("clientes").delete().in("documento", huerfanos.slice(i, i + 100));
      if (error) throw error;
    }

    return Response.json({ procesos: ids.length, imagenes, clientes: huerfanos.length });
  } catch (e) {
    return responderError(e);
  }
}
