import type { FacturaExtraida } from "./extractor";
import { dvValido } from "./nit";

export const TARIFA_IVA = 0.19;
export const TARIFA_IMPOCONSUMO = 0.04; // según CLAUDE.md (restaurantes usan 8 %)
const TOLERANCIA = 1; // pesos, por redondeos

export interface Validacion {
  estado: "ok" | "revision";
  motivos: string[];
}

const cerca = (a: number, b: number): boolean => Math.abs(a - b) <= TOLERANCIA;

export function validarFactura(f: FacturaExtraida): Validacion {
  const motivos: string[] = [];

  if (!f.numero) motivos.push("Número de factura no leído");
  if (!f.fecha) motivos.push("Fecha no leída o inválida");
  if (!f.proveedor) motivos.push("Razón social del proveedor no leída");

  if (!f.nitProveedor) motivos.push("NIT del proveedor no leído");
  else if (!dvValido(f.nitProveedor)) motivos.push("DV del NIT del proveedor no coincide");

  if (!f.documentoCliente) motivos.push("Documento del cliente no leído");
  else if (!dvValido(f.documentoCliente)) motivos.push("DV del documento del cliente no coincide");

  if (f.subtotal === null || f.total === null) {
    motivos.push("Subtotal o total no leídos");
  } else {
    const iva = f.iva ?? 0;
    const inc = f.impoconsumo ?? 0;
    const soloImpoconsumo = inc > 0 && iva === 0; // restaurantes: el INC reemplaza al IVA
    if (!soloImpoconsumo && !cerca(iva, Math.round(f.subtotal * TARIFA_IVA)))
      motivos.push("IVA diferente a la tarifa general (19 %)");
    if (inc > 0 && !cerca(inc, Math.round(f.subtotal * TARIFA_IMPOCONSUMO)))
      motivos.push("Impoconsumo diferente a la tarifa (4 %)");
    if (!cerca(f.total, f.subtotal + iva + inc)) motivos.push("Total no coincide con subtotal + impuestos");

    if (f.items.length) {
      const suma = f.items.reduce((s, i) => s + i.total, 0);
      if (!cerca(suma, f.subtotal)) motivos.push("Suma de ítems no coincide con el subtotal");
      if (f.items.some((i) => !cerca(i.cantidad * i.valorUnitario, i.total)))
        motivos.push("Ítem con cantidad × valor unitario incoherente");
    }
  }

  return { estado: motivos.length ? "revision" : "ok", motivos };
}
