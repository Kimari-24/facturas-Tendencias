/** Mayor monto que cabe en las columnas numeric(14,2) de la base. Un valor mayor (casi siempre ruido del OCR) hace fallar el guardado. */
export const MAX_MONTO = 999_999_999_999.99;

/**
 * Convierte montos en formato colombiano o anglosajón a número.
 * "1.234.567,50" → 1234567.5 · "$ 1,234,567" → 1234567 · "19.000" → 19000 · "12,5" → 12.5
 */
export function parsearMonto(texto: string): number | null {
  const limpio = texto.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(limpio)) return null;

  const ultPunto = limpio.lastIndexOf(".");
  const ultComa = limpio.lastIndexOf(",");
  let normal: string;

  if (ultPunto >= 0 && ultComa >= 0) {
    // El separador que aparece de último es el decimal
    const decimal = ultPunto > ultComa ? "." : ",";
    const miles = decimal === "." ? "," : ".";
    normal = limpio.split(miles).join("").replace(decimal, ".");
  } else if (ultPunto >= 0 || ultComa >= 0) {
    const sep = ultPunto >= 0 ? "." : ",";
    const partes = limpio.split(sep);
    const esMiles = partes.length > 2 || partes[partes.length - 1].length === 3;
    normal = esMiles ? partes.join("") : partes.join(".");
  } else {
    normal = limpio;
  }

  const n = Number(normal);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/**
 * Fechas "2026-10-05", "05/10/2026", "5-10-26", "16 de octubre de 2026" → ISO.
 * Si hay varias, toma la que aparece primero en el texto.
 */
export function parsearFecha(texto: string): string | null {
  const candidatos: { i: number; a: number; m: number; d: number }[] = [];
  const iso = texto.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) candidatos.push({ i: iso.index!, a: +iso[1], m: +iso[2], d: +iso[3] });
  const lat = texto.match(/(?<!\d)(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/);
  if (lat) candidatos.push({ i: lat.index!, a: +lat[3] < 100 ? +lat[3] + 2000 : +lat[3], m: +lat[2], d: +lat[1] });
  const larga = texto.match(new RegExp(`(\\d{1,2})\\s+de\\s+(${MESES.join("|")})\\s+(?:de|del)\\s+(\\d{4})`, "i"));
  if (larga) candidatos.push({ i: larga.index!, a: +larga[3], m: MESES.indexOf(larga[2].toLowerCase()) + 1, d: +larga[1] });
  if (!candidatos.length) return null;

  const { a, m, d } = candidatos.sort((x, y) => x.i - y.i)[0];

  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return f.toISOString().slice(0, 10);
}
