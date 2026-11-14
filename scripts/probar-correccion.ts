// Fase 9 (API): corrección manual de la factura que quedó en revisión.
import ExcelJS from "exceljs";
import { admin, BASE, CORRECCION_0006, ok, prepararEntorno, procesarMuestras, terminar } from "./_comun";

async function main(): Promise<void> {
  const e = await prepararEntorno();
  try {
    const procesoId = await procesarMuestras(e);
    const { data: rev } = await admin.from("facturas").select("hash, numero").eq("proceso_id", procesoId).eq("estado", "revision");
    ok(rev?.length === 1 && rev[0].numero === "FE-000601", `1 factura en revisión: ${rev?.[0]?.numero}`);
    const hash = rev![0].hash as string;
    const corregir = (cuerpo: unknown): Promise<Response> =>
      e.api(`/api/facturas/${hash}/corregir`, { body: JSON.stringify(cuerpo) });

    const sin = await fetch(`${BASE}/api/facturas/${hash}/corregir`, { method: "POST", body: "{}" });
    ok(sin.status === 401, `sin sesión → ${sin.status}`);
    const malo = await corregir({ ...CORRECCION_0006, subtotal: "mucho" });
    ok(malo.status === 400, `cuerpo inválido → ${malo.status}`);
    const noExiste = await e.api(`/api/facturas/${"0".repeat(64)}/corregir`, { body: JSON.stringify(CORRECCION_0006) });
    ok(noExiste.status === 404, `factura inexistente → ${noExiste.status}`);

    const ivaMal = await corregir({ ...CORRECCION_0006, iva: 500000 });
    const motivos = ((await ivaMal.json()) as { motivos: string[] }).motivos;
    ok(ivaMal.status === 422 && motivos.some((m) => m.includes("IVA")), `IVA incorrecto → ${ivaMal.status} (${motivos.join("; ")})`);

    const repetido = await corregir({ ...CORRECCION_0006, numero: "FE-000833", forzar: true });
    ok(repetido.status === 409, `número de otra factura (FE-000833) → ${repetido.status}`);

    const bien = await corregir(CORRECCION_0006);
    ok(bien.status === 200, `corrección válida → ${bien.status}`);
    const { data: f } = await admin.from("facturas").select("estado, manual, items, documento_cliente").eq("hash", hash).single();
    ok(f?.estado === "ok" && f.manual === true, "factura queda ok y marcada como manual");
    ok((f?.items as unknown[]).length === 4, "4 ítems corregidos guardados");
    const { data: cli } = await admin.from("clientes").select("nombre").eq("documento", "872621206").single();
    ok(cli?.nombre === CORRECCION_0006.cliente, `cliente faltante creado: ${cli?.nombre}`);

    const otraVez = await corregir(CORRECCION_0006);
    const cuenta = await admin.from("facturas").select("hash", { head: true, count: "exact" }).eq("proceso_id", procesoId);
    ok(otraVez.status === 200 && cuenta.count === 10, "corregir dos veces es idempotente (siguen 10 facturas)");

    // El Excel se genera al vuelo: ya debe reflejar la corrección
    const rx = await fetch(`${BASE}/api/procesos/${procesoId}/excel`, { headers: { authorization: `Bearer ${e.token}` } });
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load((await rx.arrayBuffer()) as unknown as ExcelJS.Buffer);
    const resumen = new Map<string, unknown>();
    libro.getWorksheet("Resumen")!.eachRow((r) => resumen.set(String(r.getCell(1).value), r.getCell(2).value));
    ok(resumen.get("Leídas automáticamente (ok)") === 9 && resumen.get("A revisión") === 0, "Excel: 9 automáticas y 0 a revisión");
    ok(resumen.get("Corregidas manualmente") === 1, "Excel: 1 corregida manualmente");
    ok(resumen.get("Total facturado") === 103705157, `Excel: total sigue en ${resumen.get("Total facturado")}`);
    const items = libro.getWorksheet("Ítems")!;
    const de0006 = [] as string[];
    items.eachRow((r) => {
      if (r.getCell(1).value === "FE-000601") de0006.push(String(r.getCell(3).value));
    });
    ok(de0006.length === 4 && de0006[2].startsWith("Caja de tornillos"), "Excel: hoja Ítems con los ítems corregidos");
  } finally {
    await e.limpiar();
  }
  terminar();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
