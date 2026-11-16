import "server-only";
import type { Item } from "./facturas/extractor";
import { aExtraida, type CamposCorreccion } from "./facturas/correccion";
import { MAX_MONTO } from "./facturas/numeros";
import { validarFactura } from "./facturas/validador";
import { ErrorHttp } from "./procesos";
import { BUCKET, supabaseAdmin } from "./supabase-admin";

export interface FacturaRevision {
  hash: string;
  estado: string;
  numero: string | null;
  fecha: string | null;
  proveedor: string | null;
  nit_proveedor: string | null;
  documento_cliente: string | null;
  cliente: string | null;
  subtotal: number | null;
  iva: number | null;
  impoconsumo: number | null;
  total: number | null;
  items: Item[];
  motivos: string[];
  manual: boolean;
  ruta_imagen: string;
}

const CAMPOS =
  "hash, estado, numero, fecha, proveedor, nit_proveedor, documento_cliente, subtotal, iva, impoconsumo, total, items, motivos, manual, ruta_imagen, clientes(nombre), procesos!inner(usuario)";

type Fila = Omit<FacturaRevision, "cliente"> & { clientes: { nombre: string | null } | null };

function aRevision(f: Fila): FacturaRevision {
  const { clientes, ...resto } = f as Fila & { procesos?: unknown };
  delete (resto as { procesos?: unknown }).procesos;
  const n = (v: number | null): number | null => (v === null ? null : Number(v));
  return {
    ...resto,
    cliente: clientes?.nombre ?? null,
    subtotal: n(f.subtotal),
    iva: n(f.iva),
    impoconsumo: n(f.impoconsumo),
    total: n(f.total),
  };
}

/** Lo que muestra la lista: sin ítems, NIT ni ruta de imagen (solo se piden las columnas necesarias). */
export type FacturaLista = Pick<FacturaRevision, "hash" | "estado" | "numero" | "proveedor" | "total" | "motivos">;

const CAMPOS_LISTA = "hash, estado, numero, proveedor, total, motivos, procesos!inner(usuario)";
export const MAX_CORREGIDAS = 20;

function aLista(f: FacturaLista & { procesos?: unknown }): FacturaLista {
  return { hash: f.hash, estado: f.estado, numero: f.numero, proveedor: f.proveedor, total: f.total === null ? null : Number(f.total), motivos: f.motivos };
}

export async function listarRevision(email: string): Promise<{ pendientes: FacturaLista[]; corregidas: FacturaLista[] }> {
  const sb = supabaseAdmin();
  // Pendientes: todas (son la cola de trabajo). Corregidas: solo las últimas, para que la lista no crezca sin fin.
  const [pend, corr] = await Promise.all([
    sb.from("facturas").select(CAMPOS_LISTA).eq("procesos.usuario", email).in("estado", ["revision", "error"]).order("creado"),
    sb
      .from("facturas")
      .select(CAMPOS_LISTA)
      .eq("procesos.usuario", email)
      .eq("manual", true)
      .eq("estado", "ok")
      .order("actualizado", { ascending: false })
      .limit(MAX_CORREGIDAS),
  ]);
  if (pend.error) throw pend.error;
  if (corr.error) throw corr.error;
  return { pendientes: (pend.data as unknown as FacturaLista[]).map(aLista), corregidas: (corr.data as unknown as FacturaLista[]).map(aLista) };
}

export async function obtenerFactura(hash: string, email: string): Promise<FacturaRevision & { imagenUrl: string }> {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new ErrorHttp(404, "Factura no existe");
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("facturas").select(CAMPOS).eq("hash", hash).eq("procesos.usuario", email).maybeSingle();
  if (error) throw error;
  if (!data) throw new ErrorHttp(404, "Factura no existe");
  const f = aRevision(data as unknown as Fila);
  // URL firmada de corta duración: el bucket sigue privado
  const firmada = await sb.storage.from(BUCKET).createSignedUrl(f.ruta_imagen, 600);
  if (firmada.error) throw firmada.error;
  return { ...f, imagenUrl: firmada.data.signedUrl };
}

export interface Correccion extends CamposCorreccion {
  forzar: boolean;
}

/** Valida la forma del JSON recibido (sin dependencias). */
export function leerCorreccion(json: unknown): Correccion {
  if (typeof json !== "object" || json === null) throw new ErrorHttp(400, "Cuerpo inválido");
  const o = json as Record<string, unknown>;
  const texto = (k: string): string => {
    if (o[k] !== undefined && o[k] !== null && typeof o[k] !== "string") throw new ErrorHttp(400, `${k} debe ser texto`);
    return String(o[k] ?? "").trim();
  };
  const monto = (k: string): number | null => {
    const v = o[k];
    if (v === null || v === undefined || v === "") return null;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > MAX_MONTO)
      throw new ErrorHttp(400, `${k} debe ser un número entre 0 y ${MAX_MONTO}`);
    return Math.round(v * 100) / 100;
  };
  if (!Array.isArray(o.items)) throw new ErrorHttp(400, "items debe ser una lista");
  const items = o.items.map((i: unknown, n): Item => {
    const it = (i ?? {}) as Record<string, unknown>;
    const nums = [it.cantidad, it.valorUnitario, it.total];
    if (!nums.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0) || typeof it.descripcion !== "string")
      throw new ErrorHttp(400, `Ítem ${n + 1} inválido`);
    return { cantidad: it.cantidad as number, descripcion: it.descripcion.trim(), valorUnitario: it.valorUnitario as number, total: it.total as number };
  });
  const fecha = texto("fecha");
  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ErrorHttp(400, "fecha debe ser AAAA-MM-DD");
  return {
    numero: texto("numero").toUpperCase(),
    fecha,
    proveedor: texto("proveedor"),
    nitProveedor: texto("nitProveedor"),
    cliente: texto("cliente"),
    documentoCliente: texto("documentoCliente"),
    subtotal: monto("subtotal"),
    iva: monto("iva"),
    impoconsumo: monto("impoconsumo"),
    total: monto("total"),
    items,
    forzar: o.forzar === true,
  };
}

export type ResultadoCorreccion = { guardada: true } | { guardada: false; motivos: string[] };

/**
 * Aplica la corrección humana. Si las reglas tributarias aún fallan devuelve los motivos
 * y solo guarda con `forzar` (el humano asume la responsabilidad).
 */
export async function corregirFactura(hash: string, email: string, c: Correccion): Promise<ResultadoCorreccion> {
  const actual = await obtenerFactura(hash, email); // existencia + dueño
  // Si el OCR aún no termina, su resultado pisaría la corrección
  if (actual.estado === "pendiente" || actual.estado === "procesando")
    throw new ErrorHttp(409, "La factura aún se está procesando");

  const extraida = aExtraida(c);
  const nit = extraida.nitProveedor;
  const doc = extraida.documentoCliente;
  const { motivos } = validarFactura(extraida);
  if (motivos.length && !c.forzar) return { guardada: false, motivos };

  const sb = supabaseAdmin();
  if (doc) {
    // Crea el cliente si falta; si existe, actualiza el nombre corregido
    const { error } = await sb.from("clientes").upsert({ documento: doc.numero, nombre: c.cliente || null }, { onConflict: "documento" });
    if (error) throw error;
  }

  const { error } = await sb
    .from("facturas")
    .update({
      estado: "ok",
      manual: true,
      numero: extraida.numero,
      fecha: extraida.fecha,
      proveedor: extraida.proveedor,
      nit_proveedor: nit ? `${nit.numero}${nit.dv === null ? "" : `-${nit.dv}`}` : null,
      documento_cliente: doc?.numero ?? null,
      subtotal: c.subtotal,
      iva: c.iva,
      impoconsumo: c.impoconsumo,
      total: c.total,
      items: c.items,
      motivos: motivos.map((m) => `Aceptado manualmente: ${m}`),
      actualizado: new Date().toISOString(),
    })
    .eq("hash", hash);
  if (error?.code === "23505") throw new ErrorHttp(409, `El número ${extraida.numero} ya existe en otra factura`);
  if (error) throw error;
  return { guardada: true };
}
