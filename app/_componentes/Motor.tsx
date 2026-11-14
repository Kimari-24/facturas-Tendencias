"use client";

import Link from "next/link";
import { useState, type ChangeEvent, type DragEvent } from "react";

const MAX_IMAGENES = 100;
const SUBIDAS_PARALELAS = 4;
const TRABAJADORES = 3; // llamadas concurrentes a /lote
const TIPOS = /\.(jpe?g|png|webp)$/i;

type Fase = "inicio" | "subiendo" | "procesando" | "listo" | "error";
type EstadoFila = "espera" | "subiendo" | "leyendo" | "duplicada" | "rechazada" | "ok" | "revision" | "error";

interface Leida {
  hash: string;
  estado: "ok" | "revision" | "error";
  numero: string | null;
  proveedor: string | null;
  total: number | null;
  motivo: string | null;
}

interface Fila {
  nombre: string;
  bytes: number;
  estado: EstadoFila;
  hash?: string;
  numero?: string | null;
  proveedor?: string | null;
  total?: number | null;
  detalle?: string | null;
}

interface Resumen {
  total: number;
  ok: number;
  revision: number;
  error: number;
  sumaTotal: number;
}

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const kb = (b: number): string => (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

const ETIQUETA: Record<EstadoFila, string> = {
  espera: "En cola",
  subiendo: "Subiendo",
  leyendo: "Leyendo",
  duplicada: "Ya procesada",
  rechazada: "Rechazada",
  ok: "Correcta",
  revision: "A revisión",
  error: "Error",
};
const TONO: Partial<Record<EstadoFila, string>> = { ok: "tag--ok", revision: "tag--aviso", error: "tag--error", rechazada: "tag--error" };

async function postJson<T>(url: string, body?: BodyInit): Promise<{ status: number; datos: T }> {
  const r = await fetch(url, { method: "POST", body });
  if (r.status === 401) throw new Error("Tu sesión expiró: vuelve a iniciar sesión");
  return { status: r.status, datos: (await r.json()) as T };
}

/**
 * Vercel no acepta peticiones de más de 4,5 MB (las fotos de celular suelen pesar 3–8 MB).
 * Si la imagen pasa de 3,5 MB se reduce en el navegador a JPEG de máx. 2000 px, la resolución a la que
 * se guarda y se lee de todos modos. Las más livianas se suben tal cual.
 */
const LIMITE_SUBIDA = 3.5 * 1024 * 1024;
async function prepararParaSubir(archivo: File): Promise<Blob> {
  if (archivo.size <= LIMITE_SUBIDA) return archivo;
  const imagen = await createImageBitmap(archivo, { imageOrientation: "from-image" });
  const escala = Math.min(1, 2000 / imagen.width);
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(imagen.width * escala);
  lienzo.height = Math.round(imagen.height * escala);
  lienzo.getContext("2d")?.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  imagen.close();
  const blob = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, "image/jpeg", 0.9));
  if (!blob) throw new Error("No se pudo reducir la imagen");
  return blob;
}

/** Ejecuta `tarea` sobre cada índice con un máximo de `n` simultáneas. */
async function enParalelo(total: number, n: number, tarea: (i: number) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, total) }, async () => {
      while (i < total) await tarea(i++);
    }),
  );
}

export function Motor() {
  const [archivos, setArchivos] = useState<File[]>([]);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [fase, setFase] = useState<Fase>("inicio");
  const [procesoId, setProcesoId] = useState("");
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [mensaje, setMensaje] = useState("");
  const [segundos, setSegundos] = useState("");
  const [encima, setEncima] = useState(false);

  const ocupado = fase === "subiendo" || fase === "procesando";

  function tomar(lista: File[]): void {
    const imagenes = lista.filter((f) => TIPOS.test(f.name));
    const elegidas = imagenes.slice(0, MAX_IMAGENES);
    setArchivos(elegidas);
    setFilas(elegidas.map((f) => ({ nombre: f.name, bytes: f.size, estado: "espera" })));
    setMensaje(
      imagenes.length > MAX_IMAGENES
        ? `Solo se tomarán las primeras ${MAX_IMAGENES} imágenes.`
        : lista.length > imagenes.length
          ? `Se ignoraron ${lista.length - imagenes.length} archivo(s) que no son JPG, PNG o WebP.`
          : "",
    );
    setFase("inicio");
    setResumen(null);
  }

  function elegir(e: ChangeEvent<HTMLInputElement>): void {
    tomar(Array.from(e.target.files ?? []));
    e.target.value = ""; // permite volver a elegir los mismos archivos
  }

  function soltar(e: DragEvent<HTMLElement>): void {
    e.preventDefault();
    setEncima(false);
    if (!ocupado) tomar(Array.from(e.dataTransfer.files));
  }

  const cambiar = (i: number, cambio: Partial<Fila>): void => setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ...cambio } : f)));

  async function iniciar(): Promise<void> {
    try {
      const t0 = performance.now();
      setFase("subiendo");
      setMensaje("");
      const { datos } = await postJson<{ id: string }>("/api/procesos");
      setProcesoId(datos.id);

      // 1) Subida: una imagen por petición (respeta el límite de 4.5 MB de Vercel)
      const porHash = new Map<string, number>();
      await enParalelo(archivos.length, SUBIDAS_PARALELAS, async (i) => {
        cambiar(i, { estado: "subiendo" });
        // Un fallo de una imagen (red, archivo enorme) no detiene el lote: se marca y se sigue con las demás
        type RespSubida = { hash?: string; duplicada?: boolean; error?: string };
        let r: { status: number; datos: RespSubida };
        try {
          const cuerpo = await prepararParaSubir(archivos[i]);
          const subir = (): Promise<{ status: number; datos: RespSubida }> => postJson<RespSubida>(`/api/procesos/${datos.id}/imagenes`, cuerpo);
          r = await subir().catch(subir); // 1 reintento por si fue un corte de red
        } catch (e) {
          return cambiar(i, { estado: "rechazada", detalle: e instanceof Error && e.message.startsWith("Tu sesión") ? e.message : "No se pudo subir (conexión o archivo demasiado grande)" });
        }
        if (r.status >= 400) return cambiar(i, { estado: "rechazada", detalle: r.datos.error ?? "No se pudo subir" });
        if (r.datos.duplicada) return cambiar(i, { estado: "duplicada", hash: r.datos.hash, detalle: "Esta imagen ya se había cargado antes" });
        porHash.set(r.datos.hash ?? "", i);
        cambiar(i, { estado: "leyendo", hash: r.datos.hash });
      });

      // 2) Motor: 3 trabajadores llaman a /lote hasta vaciar la cola. El cron del servidor también
      //    procesa: si no queda nada que reclamar pero hay facturas en curso, se espera a que terminen.
      setFase("procesando");
      await Promise.all(
        Array.from({ length: TRABAJADORES }, async () => {
          for (let vueltas = 0; vueltas < 300; vueltas++) {
            const r = await postJson<{ procesadas: Leida[]; restantes: number }>(`/api/procesos/${datos.id}/lote`);
            if (r.status >= 400) throw new Error("Falló el procesamiento");
            for (const l of r.datos.procesadas) {
              const i = porHash.get(l.hash);
              if (i !== undefined) cambiar(i, { estado: l.estado, numero: l.numero, proveedor: l.proveedor, total: l.total, detalle: l.motivo });
            }
            if (r.datos.restantes === 0) break;
            if (r.datos.procesadas.length === 0) await new Promise((ok) => setTimeout(ok, 3000));
          }
        }),
      );

      // Las que leyó el cron del servidor no pasaron por este navegador: se piden al final
      const estados = await fetch(`/api/procesos/${datos.id}/facturas`);
      if (estados.ok)
        for (const l of (await estados.json()) as Leida[]) {
          const i = porHash.get(l.hash);
          if (i !== undefined) cambiar(i, { estado: l.estado, numero: l.numero, proveedor: l.proveedor, total: l.total, detalle: l.motivo });
        }

      // 3) Cierre
      const fin = await postJson<Resumen & { error?: string }>(`/api/procesos/${datos.id}/finalizar`);
      if (fin.status >= 400) throw new Error(String(fin.datos.error));
      setResumen(fin.datos);
      setSegundos(((performance.now() - t0) / 1000).toFixed(1));
      setFase("listo");
    } catch (e) {
      setMensaje(e instanceof Error ? e.message : "Error inesperado");
      setFase("error");
    }
  }

  const leidas = filas.filter((f) => ["ok", "revision", "error"].includes(f.estado)).length;
  const porLeer = filas.filter((f) => ["leyendo", "ok", "revision", "error"].includes(f.estado)).length;
  const subidas = filas.filter((f) => !["espera", "subiendo"].includes(f.estado)).length;
  const aRevisar = resumen ? resumen.revision + resumen.error : 0;

  return (
    <section className="space-y-6">
      {/* Zona de carga */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!ocupado) setEncima(true);
        }}
        onDragLeave={() => setEncima(false)}
        onDrop={soltar}
        className={`zona ${encima ? "zona--encima" : ""} ${filas.length ? "zona--compacta" : ""}`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 shrink-0 text-text-muted" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Arrastra las facturas aquí</p>
          <p className="text-text-muted">JPG, PNG o WebP · hasta 4 MB cada una · máximo {MAX_IMAGENES} por lote</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className={`btn btn--sm ${ocupado ? "pointer-events-none opacity-50" : ""}`}>
            Elegir archivos
            <input
              data-testid="archivos"
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={elegir}
              disabled={ocupado}
            />
          </label>
          <label className={`btn btn--sm ${ocupado ? "pointer-events-none opacity-50" : ""}`}>
            Elegir carpeta
            <input type="file" className="sr-only" onChange={elegir} disabled={ocupado} {...{ webkitdirectory: "", directory: "" }} />
          </label>
        </div>
      </div>

      {mensaje && (
        <p role="alert" className={`text-sm ${fase === "error" ? "text-danger" : "text-text-muted"}`}>
          {mensaje}
        </p>
      )}

      {filas.length > 0 && (
        <div className="space-y-3">
          {/* Barra de acciones / progreso */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <p className="text-sm">
              <span className="font-semibold">{archivos.length} imágenes seleccionadas</span>
              {fase === "subiendo" && <span className="text-text-muted"> · subiendo {subidas} de {archivos.length}</span>}
              {fase === "procesando" && <span className="text-text-muted"> · leídas {leidas} de {porLeer}</span>}
            </p>
            {(fase === "inicio" || fase === "error") && (
              <button onClick={iniciar} disabled={!archivos.length} className="btn btn--primary btn--sm ml-auto">
                Iniciar lectura
              </button>
            )}
            {ocupado && (
              <span className="ml-auto flex items-center gap-2 text-sm text-text-muted">
                <span className="girando" aria-hidden="true" />
                {fase === "procesando" ? "Procesando… puedes cerrar la página: el servidor termina el lote" : "Subiendo… no cierres la página"}
              </span>
            )}
          </div>
          {ocupado && (
            <div className="pista" aria-hidden="true">
              <div style={{ width: `${Math.round(((fase === "subiendo" ? subidas : leidas) / Math.max(1, fase === "subiendo" ? archivos.length : porLeer)) * 100)}%` }} />
            </div>
          )}

          {/* Resultado del lote */}
          {fase === "listo" && resumen && (
            <div data-testid="resumen" className="resumen">
              <dl className="flex flex-wrap gap-x-8 gap-y-2">
                <Dato titulo="Facturas" valor={String(resumen.total)} />
                <Dato titulo="Correctas" valor={String(resumen.ok)} tono="text-ok" />
                <Dato titulo="A revisión" valor={String(aRevisar)} tono={aRevisar ? "text-warning" : ""} />
                <Dato titulo="Total facturado" valor={pesos.format(resumen.sumaTotal)} />
              </dl>
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-2 text-xs text-text-muted">Terminado en {segundos} s</span>
                {aRevisar > 0 && (
                  <Link href="/revision" className="btn btn--sm">
                    Revisar {aRevisar} {aRevisar === 1 ? "factura" : "facturas"}
                  </Link>
                )}
                <a href={`/api/procesos/${procesoId}/excel`} className="btn btn--primary btn--sm" download>
                  Descargar Excel
                </a>
              </div>
            </div>
          )}

          {/* Una fila por factura */}
          <div className="well overflow-x-auto">
            <table className="tabla tabla--compacta">
              <thead>
                <tr>
                  <th className="text-left">Archivo</th>
                  <th className="text-left">Estado</th>
                  <th className="text-left">Proveedor</th>
                  <th className="text-left">Número</th>
                  <th className="text-right">Total</th>
                  <th className="w-px" />
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr key={`${f.nombre}-${i}`}>
                    <td>
                      <span className="block max-w-56 truncate text-text" title={f.nombre}>
                        {f.nombre}
                      </span>
                      <span className="text-xs">{kb(f.bytes)}</span>
                    </td>
                    <td>
                      <span className={`tag ${TONO[f.estado] ?? ""}`}>
                        {(f.estado === "subiendo" || f.estado === "leyendo") && <span className="girando" aria-hidden="true" />}
                        {ETIQUETA[f.estado]}
                      </span>
                      {f.detalle && f.estado !== "ok" && <span className="mt-1 block text-xs">{f.detalle}</span>}
                    </td>
                    <td className="max-w-64 truncate">{f.proveedor ?? "—"}</td>
                    <td className="lcd">{f.numero ?? "—"}</td>
                    <td className="lcd text-right">{f.total == null ? "—" : pesos.format(f.total)}</td>
                    <td className="text-right">
                      {(f.estado === "revision" || f.estado === "error") && f.hash && (
                        <Link href={`/revision/${f.hash}`} className="enlace whitespace-nowrap">
                          Corregir
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function Dato({ titulo, valor, tono = "" }: { titulo: string; valor: string; tono?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-sm text-text-muted">{titulo}</dt>
      <dd className={`lcd text-lg ${tono}`}>{valor}</dd>
    </div>
  );
}
