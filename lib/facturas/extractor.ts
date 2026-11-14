import { parsearDocumento, type Documento } from "./nit";
import { parsearFecha, parsearMonto } from "./numeros";

export interface Item {
  cantidad: number;
  descripcion: string;
  valorUnitario: number;
  total: number;
}

export interface FacturaExtraida {
  numero: string | null;
  fecha: string | null;
  proveedor: string | null;
  nitProveedor: Documento | null;
  cliente: string | null;
  documentoCliente: Documento | null;
  subtotal: number | null;
  iva: number | null;
  impoconsumo: number | null;
  total: number | null;
  items: Item[];
}

// Monto: con "$" o con separador de miles (evita confundir teléfonos o direcciones con dinero)
const MONTO = String.raw`(\$\s*\d[\d.,]*|\d{1,3}(?:[.,]\d{3})+(?:,\d{1,2})?)`;

const ETIQUETAS = {
  subtotal: /^(sub\s*-?\s*total|valor\s+antes\s+de\s+iva|base\s+gravable)\b/i,
  iva: /^(iva|i\.v\.a\.?)\b/i,
  impoconsumo: /^(impo\s*-?\s*consumo|imp\.?\s*consumo|inc)\b/i,
  total: /^(valor\s+)?total(\s+(a\s+pagar|factura))?\b/i,
};

const SOCIEDAD = /\b(S[.:]?\s?A[.:]?\s?S[.:]?|S[.:]?\s?A[.:]?|LTDA[.:]?|S[.:]?\s?C[.:]?\s?S[.:]?|E[.:]?\s?U[.:]?)$/i;
const ETIQUETA_CLIENTE = /\b(cliente|adquir[ie]+nte|se[ñn]or(?:es)?)\b/i;
const ETIQUETA_DOC = /\b(c\.?\s?c|nit|documento|identificaci[oó]n)\b/i;

function lineas(texto: string): string[] {
  return texto
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function montoPorEtiqueta(ls: string[], etiqueta: RegExp): number | null {
  for (const l of ls) {
    if (!etiqueta.test(l)) continue;
    const m = l.match(new RegExp(`${MONTO}\\s*\\|?$`));
    if (m) return parsearMonto(m[1]);
  }
  return null;
}

function extraerNumero(ls: string[]): string | null {
  // Formato DIAN prefijo-consecutivo (FE-000833), ignorando rangos de la resolución
  for (const l of ls) {
    if (/rango|resoluci|res\.\s*dian/i.test(l)) continue;
    const m = l.match(/\b([A-Z]{1,5}-\d{3,12})\b/);
    if (m) return m[1];
  }
  const m = ls.join("\n").match(/factura[^:\n]*?(?:n[oº°*.]*|n[uú]mero|#)\s*[:.]?\s*([A-Z]{0,5}[-\s]?\d{1,12})/i);
  return m ? m[1].replace(/\s/g, "").toUpperCase() : null;
}

function extraerFecha(ls: string[]): string | null {
  const prioridades = [/(emisi[oó]n|expedici[oó]n)\s*:?/i, /\bfecha\b(?!\s*(de\s*)?(venc|l[ií]mite))\s*:?/i];
  for (const etiqueta of prioridades) {
    for (const l of ls) {
      const m = l.match(etiqueta);
      if (!m) continue;
      const fecha = parsearFecha(l.slice(m.index! + m[0].length));
      if (fecha) return fecha;
    }
  }
  return null;
}

function extraerProveedor(cabecera: string[]): string | null {
  for (let i = 0; i < cabecera.length; i++) {
    const l = cabecera[i].replace(/\s*\bFACTURA\b.*$/i, "").trim();
    if (!l || /\bnit\b|resoluci|\btel\b/i.test(l) || !SOCIEDAD.test(l)) continue;
    const soloSufijo = /^[\sSACLTDEU.:]+$/i.test(l);
    const nombre = soloSufijo && i > 0 ? `${cabecera[i - 1]} ${l}` : l;
    return nombre.replace(/:/g, ".");
  }
  const m = cabecera.join("\n").match(/raz[oó]n\s+social\s*[:.]?\s*(.+)/i);
  return m ? m[1].trim() : null;
}

function extraerCliente(ls: string[], i: number): string | null {
  let resto = ls[i].replace(new RegExp(`^.*?${ETIQUETA_CLIENTE.source}\\s*[:.]?\\s*`, "i"), "");
  if (!resto || /^datos\s+de\s+la\s+factura/i.test(resto)) resto = ls[i + 1] ?? "";
  const nombre = resto
    .split(/\s*(?:\bNIT\b|\bC\.?\s?C\b|Emisi[oó]n|Documento)/i)[0]
    .replace(/[,;:]\s*$/, "")
    .trim();
  return nombre.length >= 3 ? nombre : null;
}

/**
 * Ítems = líneas con dos montos al final (valor unitario y total), entre el bloque del
 * cliente y el subtotal. La cantidad se deduce de total / unitario porque cada diseño la
 * pone en una columna distinta (inicio, final o "N x").
 */
function extraerItems(ls: string[]): Item[] {
  const re = new RegExp(`^(.*?)${MONTO}\\s*\\|?\\s*(?:\\d{1,2}\\s*%\\s*\\|?\\s*)*${MONTO}\\s*\\|?$`);
  const items: Item[] = [];
  let pendiente: string[] = [];

  for (const l of ls) {
    const m = l.match(re);
    if (!m) {
      if (l.includes(":")) pendiente = []; // etiquetas (NIT:, Fecha:) no son descripción
      else if (/[a-záéíóúñ]{3,}/i.test(l)) pendiente.push(l);
      continue;
    }
    const valorUnitario = parsearMonto(m[2]);
    const total = parsearMonto(m[3]);
    if (valorUnitario === null || total === null || valorUnitario === 0) continue;

    let texto = m[1].trim();
    const cociente = total / valorUnitario;
    const cantidadDeducida = Number.isInteger(cociente) ? cociente : null;
    const nx = texto.match(/^(\d+)\s*x$/i);
    let cantidadTexto: number | null = null;

    if (nx) {
      cantidadTexto = Number(nx[1]);
      texto = pendiente.join(" ");
    } else {
      const fin = texto.match(/\s(\d+)\s*\|?$/);
      const inicio = texto.match(/^(\d+)\s+(?=\D)/);
      if (fin) {
        cantidadTexto = Number(fin[1]);
        texto = texto.slice(0, fin.index);
      } else if (inicio) {
        cantidadTexto = Number(inicio[1]);
        texto = texto.slice(inicio[0].length);
      }
      // Restos de bordes de tabla que el OCR lee como "E", "la", "[3]", "5 |"
      texto = texto.replace(/^(\[?\d+\]?\s*\|?|[A-Z]|[a-z]{1,2}|\[\S*)\s*\|?\s+(?=\S)/, "");
    }
    pendiente = [];

    items.push({
      cantidad: cantidadDeducida ?? cantidadTexto ?? 0,
      descripcion: texto.replace(/[|!]/g, "").replace(/\s+/g, " ").trim(),
      valorUnitario,
      total,
    });
  }
  return items;
}

export function extraerFactura(texto: string): FacturaExtraida {
  const ls = lineas(texto);
  const iCliente = ls.findIndex((l) => ETIQUETA_CLIENTE.test(l));
  const cabecera = iCliente < 0 ? ls : ls.slice(0, iCliente);
  const bloqueCliente = iCliente < 0 ? [] : ls.slice(iCliente, iCliente + 4);
  const iSubtotal = ls.findIndex((l) => ETIQUETAS.subtotal.test(l));

  const lineaNit = cabecera.find((l) => /\bn\.?\s*i\.?\s*t\b/i.test(l));
  const lineaDoc = bloqueCliente.find((l) => ETIQUETA_DOC.test(l));

  return {
    numero: extraerNumero(ls),
    fecha: extraerFecha(ls),
    proveedor: extraerProveedor(cabecera),
    nitProveedor: lineaNit ? parsearDocumento(lineaNit.replace(/^.*?n\.?\s*i\.?\s*t\.?\s*[:.]?/i, "")) : null,
    cliente: iCliente < 0 ? null : extraerCliente(ls, iCliente),
    documentoCliente: lineaDoc
      ? parsearDocumento(lineaDoc.replace(new RegExp(`^.*?${ETIQUETA_DOC.source}\\.?\\s*[:.]?`, "i"), ""))
      : null,
    subtotal: montoPorEtiqueta(ls, ETIQUETAS.subtotal),
    iva: montoPorEtiqueta(ls, ETIQUETAS.iva),
    impoconsumo: montoPorEtiqueta(ls, ETIQUETAS.impoconsumo),
    total: montoPorEtiqueta(ls, ETIQUETAS.total),
    items: extraerItems(ls.slice(Math.max(iCliente, 0), iSubtotal < 0 ? undefined : iSubtotal)),
  };
}
