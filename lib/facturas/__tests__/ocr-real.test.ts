import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extraerFactura } from "../extractor";
import { validarFactura } from "../validador";

// Texto OCR real de muestras/ (generado con scripts/ocr-muestras.ts, intento elegido por el motor).
const ESPERADO: [archivo: string, numero: string, total: number, estado: "ok" | "revision"][] = [
  ["factura_0001", "FE-000833", 6493830, "ok"],
  ["factura_0002", "FE-000906", 5317039, "ok"],
  ["factura_0003", "FE-000545", 27133547, "ok"],
  ["factura_0004", "FE-000386", 9961966, "ok"],
  ["factura_0005", "FE-000826", 7158921, "ok"],
  ["factura_0006", "FE-000601", 3892252, "revision"], // imagen inclinada y borrosa a propósito
  ["factura_0007", "FE-000147", 4261704, "ok"],
  ["factura_0008", "FE-000655", 2621007, "ok"],
  ["factura_0009", "FE-000077", 24922884, "ok"],
  ["factura_0010", "FE-000412", 11942007, "ok"],
];

describe("OCR real de las 10 muestras", () => {
  it.each(ESPERADO)("%s → %s, total %d, %s", (archivo, numero, total, estado) => {
    const texto = readFileSync(path.join(__dirname, "fixtures", "ocr", `${archivo}.txt`), "utf8");
    const f = extraerFactura(texto);
    expect(f.numero).toBe(numero);
    expect(f.total).toBe(total);
    expect(validarFactura(f).estado).toBe(estado);
  });
});
