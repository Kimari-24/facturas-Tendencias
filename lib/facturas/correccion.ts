import type { FacturaExtraida, Item } from "./extractor";
import { parsearDocumento } from "./nit";

/** Campos que el humano corrige. Se usa igual en el navegador (validación en vivo) y en el servidor (validación final). */
export interface CamposCorreccion {
  numero: string;
  fecha: string;
  proveedor: string;
  nitProveedor: string;
  cliente: string;
  documentoCliente: string;
  subtotal: number | null;
  iva: number | null;
  impoconsumo: number | null;
  total: number | null;
  items: Item[];
}

export function aExtraida(c: CamposCorreccion): FacturaExtraida {
  return {
    numero: c.numero || null,
    fecha: c.fecha || null,
    proveedor: c.proveedor || null,
    nitProveedor: parsearDocumento(c.nitProveedor),
    cliente: c.cliente || null,
    documentoCliente: parsearDocumento(c.documentoCliente),
    subtotal: c.subtotal,
    iva: c.iva,
    impoconsumo: c.impoconsumo,
    total: c.total,
    items: c.items,
  };
}

export type CampoCorregible = Exclude<keyof CamposCorreccion, "items"> | "items";

/** A qué campo pertenece cada motivo del validador, para mostrar el error junto a él. */
export function campoDelMotivo(motivo: string): CampoCorregible | null {
  if (motivo.startsWith("Número")) return "numero";
  if (motivo.startsWith("Fecha")) return "fecha";
  if (motivo.startsWith("Razón social")) return "proveedor";
  if (motivo.includes("NIT del proveedor")) return "nitProveedor";
  if (motivo.includes("documento del cliente") || motivo.startsWith("Documento del cliente")) return "documentoCliente";
  if (motivo.startsWith("Subtotal o total")) return "subtotal";
  if (motivo.startsWith("IVA")) return "iva";
  if (motivo.startsWith("Impoconsumo")) return "impoconsumo";
  if (motivo.startsWith("Total")) return "total";
  if (motivo.includes("tem")) return "items"; // "Suma de ítems…", "Ítem con cantidad…"
  return null;
}
