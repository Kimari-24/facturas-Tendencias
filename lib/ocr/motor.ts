import path from "node:path";
import sharp from "sharp";
import { createWorker, OEM, type Worker } from "tesseract.js";
import { extraerFactura, type FacturaExtraida } from "../facturas/extractor";
import { validarFactura, type Validacion } from "../facturas/validador";

// Idioma desde node_modules (empaquetado con outputFileTracingIncludes): sin descargas en ejecución.
const LANG_PATH = path.join(process.cwd(), "node_modules", "@tesseract.js-data", "spa", "4.0.0");

// Un worker por instancia serverless: se reutiliza entre invocaciones "calientes".
let worker: Promise<Worker> | undefined;

/** Si el worker muere, tesseract.js no rechaza la promesa: sin esto la función cuelga hasta el timeout. */
function conLimite<T>(promesa: Promise<T>, ms: number, que: string): Promise<T> {
  let reloj: NodeJS.Timeout | undefined;
  const limite = new Promise<never>((_, rechazar) => {
    reloj = setTimeout(() => rechazar(new Error(`${que}: sin respuesta en ${ms / 1000} s`)), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(reloj));
}

function obtenerWorker(): Promise<Worker> {
  worker ??= conLimite(
    createWorker("spa", OEM.LSTM_ONLY, {
      langPath: LANG_PATH,
      gzip: true,
      cacheMethod: "none", // filesystem de Vercel es solo lectura
    }),
    25_000,
    "Iniciar OCR",
  ).catch((e: unknown) => {
    worker = undefined;
    throw e;
  });
  return worker;
}

async function reconocer(w: Worker, imagen: Buffer): Promise<{ text: string; confidence: number }> {
  try {
    return (await conLimite(w.recognize(imagen), 20_000, "OCR")).data;
  } catch (e) {
    worker = undefined; // worker dañado: el siguiente intento crea uno nuevo
    void w.terminate().catch(() => {});
    throw e;
  }
}

export async function cerrarMotor(): Promise<void> {
  if (!worker) return;
  const w = await worker;
  worker = undefined;
  await w.terminate();
}

export type Intento = "original" | "preprocesado" | "invertido";

export interface ResultadoOcr {
  intento: Intento;
  texto: string;
  confianza: number;
  extraida: FacturaExtraida;
  validacion: Validacion;
  ms: number;
}

const INTENTOS: Record<Intento, (img: Buffer) => Promise<Buffer>> = {
  // .rotate() sin argumentos aplica la orientación EXIF de fotos de celular
  original: (img) => sharp(img).rotate().png().toBuffer(),
  preprocesado: (img) =>
    sharp(img).rotate().grayscale().normalise().resize({ width: 2000, withoutEnlargement: false }).sharpen().png().toBuffer(),
  invertido: (img) =>
    sharp(img).rotate().rotate(180).grayscale().normalise().resize({ width: 2000, withoutEnlargement: false }).png().toBuffer(),
};

/** Campos útiles extraídos: sirve para elegir el mejor intento si ninguno queda "ok". */
function puntaje(f: FacturaExtraida): number {
  const campos = [f.numero, f.fecha, f.proveedor, f.nitProveedor, f.documentoCliente, f.subtotal, f.iva, f.total];
  return campos.filter((c) => c !== null).length + Math.min(f.items.length, 3) * 0.1;
}

/** Original → preprocesado → encabezado invertido. Se detiene en el primer intento que valida "ok". */
export async function procesarImagen(imagen: Buffer): Promise<ResultadoOcr> {
  let mejor: ResultadoOcr | undefined;

  for (const intento of Object.keys(INTENTOS) as Intento[]) {
    const t0 = performance.now();
    const data = await reconocer(await obtenerWorker(), await INTENTOS[intento](imagen));
    const extraida = extraerFactura(data.text);
    const resultado: ResultadoOcr = {
      intento,
      texto: data.text,
      confianza: Math.round(data.confidence),
      extraida,
      validacion: validarFactura(extraida),
      ms: Math.round(performance.now() - t0),
    };
    if (resultado.validacion.estado === "ok") return resultado;
    if (!mejor || puntaje(extraida) > puntaje(mejor.extraida)) mejor = resultado;
  }
  return mejor!;
}
