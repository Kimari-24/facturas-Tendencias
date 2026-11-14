import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { comprimirParaGuardar } from "./imagen";
import { procesarImagen } from "./ocr/motor";
import { BUCKET, supabaseAdmin } from "./supabase-admin";

export const MAX_BYTES = 4 * 1024 * 1024; // < 4.5 MB de body en Vercel
export const MAX_IMAGENES = 100;
const FORMATOS = { jpeg: "jpg", png: "png", webp: "webp" } as const;
const ARRIENDO_MS = 5 * 60_000; // una factura "procesando" más vieja que esto se puede reclamar otra vez

export class ErrorHttp extends Error {
  constructor(
    readonly status: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

export function responderError(e: unknown): Response {
  if (e instanceof ErrorHttp) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Error interno" }, { status: 500 });
}

export async function crearProceso(email: string): Promise<string> {
  const { data, error } = await supabaseAdmin().from("procesos").insert({ usuario: email }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

interface Proceso {
  id: string;
  usuario: string;
  estado: "subiendo" | "procesando" | "finalizado";
}

export async function obtenerProceso(id: string, email: string): Promise<Proceso> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ErrorHttp(404, "Proceso no existe");
  const { data, error } = await supabaseAdmin().from("procesos").select("id, usuario, estado").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data || data.usuario !== email) throw new ErrorHttp(404, "Proceso no existe");
  return data as Proceso;
}

export interface Subida {
  hash: string;
  duplicada: boolean;
}

/** Valida por contenido (no por extensión), sube a Storage y encola. Idempotente por SHA-256. */
export async function subirImagen(proceso: Proceso, bytes: Buffer): Promise<Subida> {
  if (proceso.estado === "finalizado") throw new ErrorHttp(409, "El proceso ya está finalizado");
  if (bytes.length === 0) throw new ErrorHttp(400, "Archivo vacío");
  if (bytes.length > MAX_BYTES) throw new ErrorHttp(413, "Imagen mayor a 4 MB");

  let formato: string | undefined;
  try {
    formato = (await sharp(bytes).metadata()).format;
  } catch {
    throw new ErrorHttp(415, "No es una imagen válida");
  }
  const ext = FORMATOS[formato as keyof typeof FORMATOS];
  if (!ext) throw new ErrorHttp(415, `Formato no soportado: ${formato}`);

  const sb = supabaseAdmin();
  // La huella es del archivo ORIGINAL: la misma foto subida dos veces sigue detectándose como duplicada
  const hash = createHash("sha256").update(bytes).digest("hex");

  // Límite del proceso y atajo por hash (si ya existe, no se sube ni se procesa otra vez): consultas independientes, en paralelo
  const [{ count }, { data: existente }] = await Promise.all([
    sb.from("facturas").select("hash", { head: true, count: "exact" }).eq("proceso_id", proceso.id),
    sb.from("facturas").select("hash").eq("hash", hash).maybeSingle(),
  ]);
  if (existente) return { hash, duplicada: true };
  if ((count ?? 0) >= MAX_IMAGENES) throw new ErrorHttp(409, `Máximo ${MAX_IMAGENES} imágenes por proceso`);

  // Se guarda comprimida (WebP ≤ 2000 px): el OCR y el visor usan esta versión
  const guardar = await comprimirParaGuardar(bytes, formato ?? ext);
  const ruta = `${hash}.${guardar.ext}`;
  const subida = await sb.storage.from(BUCKET).upload(ruta, guardar.bytes, { contentType: guardar.tipo, upsert: true });
  if (subida.error) throw subida.error;

  const { error } = await sb.from("facturas").insert({ hash, proceso_id: proceso.id, ruta_imagen: ruta });
  if (error?.code === "23505") return { hash, duplicada: true }; // carrera: otra petición la insertó
  if (error) throw error;
  return { hash, duplicada: false };
}

/**
 * Reclama una factura pendiente (o con arriendo vencido) con un UPDATE condicional atómico.
 * Sin `procesoId` reclama la más antigua de cualquier proceso (lo usa el cron del servidor).
 */
async function reclamar(procesoId?: string): Promise<{ hash: string; ruta_imagen: string } | null> {
  const sb = supabaseAdmin();
  const vencido = new Date(Date.now() - ARRIENDO_MS).toISOString();
  let consulta = sb
    .from("facturas")
    .select("hash, estado, actualizado")
    .or(`estado.eq.pendiente,and(estado.eq.procesando,actualizado.lt.${vencido})`);
  if (procesoId) consulta = consulta.eq("proceso_id", procesoId);
  const { data: candidatas } = await consulta.order("creado").limit(3);

  for (const c of candidatas ?? []) {
    const { data } = await sb
      .from("facturas")
      .update({ estado: "procesando", actualizado: new Date().toISOString() })
      .eq("hash", c.hash)
      .eq("estado", c.estado)
      .eq("actualizado", c.actualizado) // si otro la tomó primero, no coincide y no actualiza
      .select("hash, ruta_imagen")
      .maybeSingle();
    if (data) return data;
  }
  return null;
}

export type Leida = ResultadoLote["procesadas"][number];

async function guardarResultado(hash: string, ruta: string): Promise<Leida> {
  const sb = supabaseAdmin();
  const descarga = await sb.storage.from(BUCKET).download(ruta);
  if (descarga.error) throw descarga.error;

  const r = await procesarImagen(Buffer.from(await descarga.data.arrayBuffer()));
  const f = r.extraida;
  const motivos = [...r.validacion.motivos];
  let estado = r.validacion.estado;

  if (f.documentoCliente) {
    const { error } = await sb
      .from("clientes")
      .upsert({ documento: f.documentoCliente.numero, nombre: f.cliente }, { onConflict: "documento", ignoreDuplicates: true });
    if (error) throw error;
  }

  const fila = {
    estado,
    numero: f.numero,
    fecha: f.fecha,
    proveedor: f.proveedor,
    nit_proveedor: f.nitProveedor ? `${f.nitProveedor.numero}${f.nitProveedor.dv === null ? "" : `-${f.nitProveedor.dv}`}` : null,
    documento_cliente: f.documentoCliente?.numero ?? null,
    subtotal: f.subtotal,
    iva: f.iva,
    impoconsumo: f.impoconsumo,
    total: f.total,
    items: f.items,
    motivos,
    texto_ocr: r.texto,
    actualizado: new Date().toISOString(),
  };

  let numero = f.numero;
  let { error } = await sb.from("facturas").update(fila).eq("hash", hash);
  if (error?.code === "23505") {
    // Mismo número en otra imagen distinta: posible factura repetida → revisión humana
    estado = "revision";
    motivos.push(`Número ${f.numero} ya registrado en otra imagen`);
    numero = null;
    ({ error } = await sb.from("facturas").update({ ...fila, estado, motivos, numero: null }).eq("hash", hash));
  }
  if (error) throw error;
  return { hash, estado, numero, proveedor: f.proveedor, total: f.total, motivo: motivos[0] ?? null };
}

/** OCR + guardado de una factura ya reclamada; si algo falla la deja en "error" (no se reintenta en bucle). */
async function procesarUna(f: { hash: string; ruta_imagen: string }): Promise<Leida> {
  try {
    return await guardarResultado(f.hash, f.ruta_imagen);
  } catch (e) {
    console.error(`Factura ${f.hash}:`, e);
    await supabaseAdmin()
      .from("facturas")
      .update({ estado: "error", motivos: ["Error interno al procesar"], actualizado: new Date().toISOString() })
      .eq("hash", f.hash);
    return { hash: f.hash, estado: "error", numero: null, proveedor: null, total: null, motivo: "Error interno al procesar" };
  }
}

export interface ResultadoLote {
  /** Lo leído de cada factura, para mostrarlo fila por fila en la carga. */
  procesadas: { hash: string; estado: "ok" | "revision" | "error"; numero: string | null; proveedor: string | null; total: number | null; motivo: string | null }[];
  restantes: number;
}

/** Procesa hasta `limite` facturas. El cliente repite la llamada mientras queden restantes. */
export async function procesarLote(proceso: Proceso, limite = 2): Promise<ResultadoLote> {
  if (proceso.estado === "finalizado") throw new ErrorHttp(409, "El proceso ya está finalizado");
  const sb = supabaseAdmin();
  if (proceso.estado === "subiendo") await sb.from("procesos").update({ estado: "procesando" }).eq("id", proceso.id);

  const procesadas: ResultadoLote["procesadas"] = [];
  for (let i = 0; i < limite; i++) {
    const f = await reclamar(proceso.id);
    if (!f) break;
    procesadas.push(await procesarUna(f));
  }

  const { count } = await sb
    .from("facturas")
    .select("hash", { head: true, count: "exact" })
    .eq("proceso_id", proceso.id)
    .in("estado", ["pendiente", "procesando"]);
  return { procesadas, restantes: count ?? 0 };
}

export interface Resumen {
  total: number;
  ok: number;
  revision: number;
  error: number;
  pendientes: number;
  sumaTotal: number;
}

export async function resumenProceso(procesoId: string): Promise<Resumen> {
  const { data, error } = await supabaseAdmin().from("facturas").select("estado, total").eq("proceso_id", procesoId);
  if (error) throw error;
  const r: Resumen = { total: data.length, ok: 0, revision: 0, error: 0, pendientes: 0, sumaTotal: 0 };
  for (const f of data) {
    if (f.estado === "ok" || f.estado === "revision" || f.estado === "error") r[f.estado as "ok" | "revision" | "error"]++;
    else r.pendientes++;
    r.sumaTotal += Number(f.total ?? 0);
  }
  return r;
}

export async function finalizarProceso(proceso: Proceso): Promise<Resumen> {
  const resumen = await resumenProceso(proceso.id);
  if (resumen.pendientes > 0) throw new ErrorHttp(409, `Quedan ${resumen.pendientes} facturas sin procesar`);
  const { error } = await supabaseAdmin()
    .from("procesos")
    .update({ estado: "finalizado", finalizado: new Date().toISOString() })
    .eq("id", proceso.id)
    .neq("estado", "finalizado"); // idempotente
  if (error) throw error;
  return resumen;
}

/** Un proceso que quedó en "subiendo" más que esto (el navegador se cerró a mitad de la subida) se cierra solo. */
const SUBIDA_ABANDONADA_MS = 30 * 60_000;

/**
 * Trabajo del cron del servidor (cada minuto desde Supabase): procesa facturas pendientes de cualquier
 * proceso hasta agotar el tiempo o la cola, y cierra los procesos que ya no tienen nada pendiente.
 * Así el lote termina aunque el usuario cierre la pestaña. Se detiene a los ~40 s para no pasar
 * el límite de 60 s de la función.
 */
export async function procesarCola(tiempoMs = 40_000): Promise<{ procesadas: number; finalizados: number }> {
  const inicio = Date.now();
  let procesadas = 0;
  // ~5 s por factura en el peor caso (3 intentos de OCR): no empieza una que no alcance a terminar
  while (Date.now() - inicio < tiempoMs - 8_000) {
    const f = await reclamar();
    if (!f) break;
    await procesarUna(f);
    procesadas++;
  }

  const sb = supabaseAdmin();
  const abandonado = new Date(Date.now() - SUBIDA_ABANDONADA_MS).toISOString();
  const { data: abiertos, error } = await sb
    .from("procesos")
    .select("id, usuario, estado")
    .or(`estado.eq.procesando,and(estado.eq.subiendo,creado.lt.${abandonado})`)
    .limit(20);
  if (error) throw error;
  let finalizados = 0;
  for (const p of (abiertos ?? []) as Proceso[]) {
    const r = await resumenProceso(p.id);
    if (r.pendientes > 0) continue;
    await finalizarProceso(p);
    finalizados++;
  }
  return { procesadas, finalizados };
}
