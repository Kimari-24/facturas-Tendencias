import { describe, expect, it } from "vitest";
import type { FacturaExtraida } from "../extractor";
import { tarifaImpoconsumoCercana, validarFactura } from "../validador";

/** Factura de restaurante: sin IVA, solo impoconsumo. */
function conImpoconsumo(subtotal: number, impoconsumo: number): FacturaExtraida {
  return {
    numero: "R-1",
    fecha: "2026-10-05",
    proveedor: "RESTAURANTE EL FOGON S.A.S.",
    nitProveedor: { numero: "900123456", dv: 8 },
    cliente: "Juan Pérez",
    documentoCliente: { numero: "1020304050", dv: null },
    subtotal,
    iva: null,
    impoconsumo,
    total: subtotal + impoconsumo,
    items: [],
  };
}

describe("impoconsumo", () => {
  it("acepta la tarifa general del 4 %", () => {
    expect(validarFactura(conImpoconsumo(50000, 2000))).toEqual({ estado: "ok", motivos: [] });
  });

  it("acepta la tarifa del 8 % (restaurantes)", () => {
    expect(validarFactura(conImpoconsumo(50000, 4000))).toEqual({ estado: "ok", motivos: [] });
  });

  it("rechaza una tarifa que no es 4 % ni 8 %", () => {
    const v = validarFactura(conImpoconsumo(50000, 3000)); // 6 %
    expect(v.estado).toBe("revision");
    expect(v.motivos).toContain("Impoconsumo diferente a las tarifas (4 % u 8 %)");
  });

  it("elige la tarifa más cercana para mostrar el cuadre", () => {
    expect(tarifaImpoconsumoCercana(50000, 2000)).toBe(0.04);
    expect(tarifaImpoconsumoCercana(50000, 4000)).toBe(0.08);
  });
});
