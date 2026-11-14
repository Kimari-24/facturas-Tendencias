import sharp from "sharp";

/** Ancho máximo guardado: el mismo al que el OCR ya lee la imagen preprocesada (no se pierde lectura). */
export const ANCHO_GUARDADO = 2000;

/**
 * Versión que se guarda en Storage: WebP calidad 85, máx. 2000 px de ancho y con la rotación EXIF ya aplicada.
 * Una foto de celular de 1–4 MB queda en ~150–300 KB: el GB del plan gratuito de Supabase alcanza para años
 * a 500 facturas/mes. Si el WebP pesara más que el original (p. ej. un PNG pequeño), se guarda el original.
 */
export async function comprimirParaGuardar(original: Buffer, formato: string): Promise<{ bytes: Buffer; ext: string; tipo: string }> {
  const webp = await sharp(original).rotate().resize({ width: ANCHO_GUARDADO, withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  if (webp.length < original.length) return { bytes: webp, ext: "webp", tipo: "image/webp" };
  return { bytes: original, ext: formato === "jpeg" ? "jpg" : formato, tipo: `image/${formato}` };
}
