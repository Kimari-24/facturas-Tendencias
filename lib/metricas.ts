import "server-only";
import { supabaseAdmin } from "./supabase-admin";

export interface Metricas {
  facturas: number;
  ok: number;
  revision: number;
  error: number;
  manuales: number;
  total: number;
  iva: number;
  impoconsumo: number;
  proveedores: { nombre: string; facturas: number; total: number }[];
  procesos: { id: string; creado: string; estado: string; facturas: number; ok: number; revision: number }[];
}

/**
 * Se agregan al vuelo (no hay contadores que se desincronicen con las correcciones manuales).
 */
export async function obtenerMetricas(email: string): Promise<Metricas> {
  // Con la migración 004 los totales los calcula Postgres (una sola consulta, sin descargar las facturas)
  const { data, error } = await supabaseAdmin().rpc("metricas_usuario", { p_usuario: email });
  if (!error) {
    const m = data as Metricas;
    // numeric de Postgres llega como número o texto según el tamaño: se normaliza
    for (const k of ["facturas", "ok", "revision", "error", "manuales", "total", "iva", "impoconsumo"] as const) m[k] = Number(m[k]);
    m.proveedores = m.proveedores.map((p) => ({ ...p, facturas: Number(p.facturas), total: Number(p.total) }));
    m.procesos = m.procesos.map((p) => ({ ...p, facturas: Number(p.facturas), ok: Number(p.ok), revision: Number(p.revision) }));
    return m;
  }
  // Sin la función (migración 004 aún no ejecutada): cálculo anterior en el servidor
  if (error.code !== "PGRST202") throw error;
  return metricasEnMemoria(email);
}

async function metricasEnMemoria(email: string): Promise<Metricas> {
  const sb = supabaseAdmin();
  // Las dos consultas son independientes (las facturas se filtran por el dueño con un join): van en paralelo
  const [{ data: procesos, error }, { data: filas, error: e2 }] = await Promise.all([
    sb.from("procesos").select("id, creado, estado").eq("usuario", email).order("creado", { ascending: false }),
    sb
      .from("facturas")
      .select("proceso_id, estado, total, iva, impoconsumo, proveedor, nit_proveedor, manual, procesos!inner(usuario)")
      .eq("procesos.usuario", email),
  ]);
  if (error) throw error;
  if (e2) throw e2;

  const m: Metricas = {
    facturas: 0, ok: 0, revision: 0, error: 0, manuales: 0, total: 0, iva: 0, impoconsumo: 0, proveedores: [], procesos: [],
  };
  const porProveedor = new Map<string, { nombre: string; facturas: number; total: number }>();
  const porProceso = new Map<string, { facturas: number; ok: number; revision: number }>();

  for (const f of filas ?? []) {
    m.facturas++;
    // "ok" = leídas automáticamente por el OCR; las corregidas a mano se cuentan aparte
    if (f.manual) m.manuales++;
    else if (f.estado === "ok") m.ok++;
    else if (f.estado === "revision") m.revision++;
    else if (f.estado === "error") m.error++;
    m.total += Number(f.total ?? 0);
    m.iva += Number(f.iva ?? 0);
    m.impoconsumo += Number(f.impoconsumo ?? 0);

    // Agrupar por NIT: el mismo proveedor puede venir escrito en mayúsculas o minúsculas
    const clave = (f.nit_proveedor as string | null) ?? (f.proveedor as string | null) ?? "(sin leer)";
    const p = porProveedor.get(clave) ?? { nombre: (f.proveedor as string | null) ?? "(sin leer)", facturas: 0, total: 0 };
    p.facturas++;
    p.total += Number(f.total ?? 0);
    porProveedor.set(clave, p);

    const pr = porProceso.get(f.proceso_id as string) ?? { facturas: 0, ok: 0, revision: 0 };
    pr.facturas++;
    if (f.estado === "ok" && !f.manual) pr.ok++;
    else if (f.estado !== "ok") pr.revision++;
    porProceso.set(f.proceso_id as string, pr);
  }

  m.proveedores = [...porProveedor.values()].sort((a, b) => b.total - a.total);
  m.procesos = procesos.map((p) => ({
    id: p.id as string,
    creado: p.creado as string,
    estado: p.estado as string,
    ...(porProceso.get(p.id as string) ?? { facturas: 0, ok: 0, revision: 0 }),
  }));
  return m;
}
