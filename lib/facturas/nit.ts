// Dígito de verificación DIAN (módulo 11 con pesos primos).
const PESOS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

export function soloDigitos(texto: string): string {
  return texto.replace(/\D/g, "");
}

export function calcularDV(nit: string): number {
  const d = soloDigitos(nit);
  if (!d || d.length > PESOS.length) throw new Error(`NIT inválido: ${nit}`);
  let suma = 0;
  for (let i = 0; i < d.length; i++) suma += Number(d[d.length - 1 - i]) * PESOS[i];
  const r = suma % 11;
  return r > 1 ? 11 - r : r;
}

export interface Documento {
  numero: string; // sin DV ni puntos
  dv: number | null;
}

/** "900.123.456-8" → { numero: "900123456", dv: 8 }. "1.020.304.050" → dv null. */
export function parsearDocumento(texto: string): Documento | null {
  const m = texto.match(/(\d[\d.\s]{4,14}\d)(?:\s*-\s*(\d))?/);
  if (!m) return null;
  const numero = soloDigitos(m[1]);
  if (numero.length < 6 || numero.length > 10) return null;
  return { numero, dv: m[2] === undefined ? null : Number(m[2]) };
}

export function dvValido(doc: Documento): boolean {
  return doc.dv === null || calcularDV(doc.numero) === doc.dv;
}
