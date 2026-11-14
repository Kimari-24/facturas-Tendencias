// Re-extrae desde los .txt OCR guardados (sin volver a correr OCR): iterar rápido sobre el extractor.
import { readdirSync, readFileSync } from "node:fs";
import { extraerFactura } from "../lib/facturas/extractor";
import { validarFactura } from "../lib/facturas/validador";

const dir = "lib/facturas/__tests__/fixtures/ocr/";
for (const a of readdirSync(dir).filter((x) => x.endsWith(".txt"))) {
  const f = extraerFactura(readFileSync(dir + a, "utf8"));
  const v = validarFactura(f);
  const doc = (d: typeof f.nitProveedor): string => (d ? `${d.numero}-${d.dv}` : "null");
  console.log(
    `${a} ${v.estado} ${f.numero} ${f.fecha} | ${f.proveedor} ${doc(f.nitProveedor)} | ${f.cliente} ${doc(f.documentoCliente)} | ` +
      `${f.subtotal} ${f.iva} ${f.impoconsumo} ${f.total} | ${f.items.map((i) => `${i.cantidad}x${i.valorUnitario}`).join(",")}`,
  );
  if (v.motivos.length) console.log(`    ${v.motivos.join("; ")}`);
}
