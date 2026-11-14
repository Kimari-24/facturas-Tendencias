// Fase 5 (local): OCR de muestras/ y guarda el texto como fixture para afinar el extractor.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cerrarMotor, procesarImagen } from "../lib/ocr/motor";

const ENTRADA = "muestras";
const SALIDA = "lib/facturas/__tests__/fixtures/ocr";
const solo = process.argv[2]; // opcional: nombre de un archivo

async function main(): Promise<void> {
  await mkdir(SALIDA, { recursive: true });
  const archivos = (await readdir(ENTRADA)).filter((a) => /\.(jpe?g|png|webp)$/i.test(a) && (!solo || a === solo)).sort();
  let ok = 0;
  const t0 = performance.now();

  for (const archivo of archivos) {
    const r = await procesarImagen(await readFile(path.join(ENTRADA, archivo)));
    await writeFile(path.join(SALIDA, archivo.replace(/\.\w+$/, ".txt")), r.texto);
    const f = r.extraida;
    if (r.validacion.estado === "ok") ok++;
    console.log(
      `${archivo} | ${r.validacion.estado.toUpperCase()} | ${r.intento} ${r.ms}ms conf ${r.confianza} | ` +
        `n=${f.numero} f=${f.fecha} nit=${f.nitProveedor?.numero}-${f.nitProveedor?.dv} cli=${f.documentoCliente?.numero} ` +
        `sub=${f.subtotal} iva=${f.iva} inc=${f.impoconsumo} tot=${f.total} items=${f.items.length}`,
    );
    if (r.validacion.motivos.length) console.log(`    motivos: ${r.validacion.motivos.join("; ")}`);
  }
  console.log(`\n${ok}/${archivos.length} ok en ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  await cerrarMotor();
}

void main();
