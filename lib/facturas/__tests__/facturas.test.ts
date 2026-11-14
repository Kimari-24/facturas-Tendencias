import { describe, expect, it } from "vitest";
import { extraerFactura } from "../extractor";
import { calcularDV, parsearDocumento } from "../nit";
import { parsearFecha, parsearMonto } from "../numeros";
import { validarFactura } from "../validador";
import { FACTURA_INC, FACTURA_MALA, FACTURA_OK } from "./fixtures/textos";

describe("nit", () => {
  it("calcula el DV DIAN", () => {
    expect(calcularDV("800197268")).toBe(4); // NIT de la DIAN
    expect(calcularDV("900123456")).toBe(8);
    expect(calcularDV("890903938")).toBe(8); // Bancolombia
  });
  it("parsea con y sin DV", () => {
    expect(parsearDocumento("900.123.456-8")).toEqual({ numero: "900123456", dv: 8 });
    expect(parsearDocumento("1.020.304.050")).toEqual({ numero: "1020304050", dv: null });
    expect(parsearDocumento("123")).toBeNull();
  });
});

describe("numeros", () => {
  it.each([
    ["$ 1.234.567", 1234567],
    ["1,234,567.50", 1234567.5],
    ["1.234.567,50", 1234567.5],
    ["19.000", 19000],
    ["12,5", 12.5],
    ["abc", null],
  ])("parsearMonto(%s) = %s", (txt, esperado) => expect(parsearMonto(txt)).toBe(esperado));

  it("parsea fechas y rechaza inválidas", () => {
    expect(parsearFecha("05/10/2026")).toBe("2026-10-05");
    expect(parsearFecha("2026-09-14")).toBe("2026-09-14");
    expect(parsearFecha("01-10-26")).toBe("2026-10-01");
    expect(parsearFecha("31/02/2026")).toBeNull();
  });
});

describe("extractor + validador", () => {
  it("factura correcta → ok", () => {
    const f = extraerFactura(FACTURA_OK);
    expect(f).toMatchObject({
      numero: "FE-1024",
      fecha: "2026-10-05",
      proveedor: "DISTRIBUIDORA EL ANDINO S.A.S.",
      nitProveedor: { numero: "900123456", dv: 8 },
      cliente: "Juan Pérez Gómez",
      documentoCliente: { numero: "1020304050", dv: null },
      subtotal: 100000,
      iva: 19000,
      total: 119000,
    });
    expect(f.items).toHaveLength(2);
    expect(validarFactura(f)).toEqual({ estado: "ok", motivos: [] });
  });

  it("factura con problemas deliberados → revisión con motivos", () => {
    const f = extraerFactura(FACTURA_MALA);
    expect(f.numero).toBe("FV88");
    expect(f.nitProveedor).toEqual({ numero: "800197268", dv: 4 });
    expect(f.documentoCliente).toEqual({ numero: "900123456", dv: 1 });
    const v = validarFactura(f);
    expect(v.estado).toBe("revision");
    expect(v.motivos).toEqual(
      expect.arrayContaining([
        "DV del documento del cliente no coincide",
        "IVA diferente a la tarifa general (19 %)",
        "Total no coincide con subtotal + impuestos",
      ]),
    );
  });

  it("restaurante con impoconsumo 4 % y sin IVA → ok", () => {
    const f = extraerFactura(FACTURA_INC);
    expect(f).toMatchObject({ numero: "R-77", subtotal: 50000, impoconsumo: 2000, total: 52000, iva: null });
    expect(validarFactura(f)).toEqual({ estado: "ok", motivos: [] });
  });

  it("texto vacío → revisión sin lanzar errores", () => {
    expect(validarFactura(extraerFactura("")).estado).toBe("revision");
  });
});
