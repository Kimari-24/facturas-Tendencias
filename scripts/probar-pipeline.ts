// Fases 3 + 6: subida por HTTP, rechazo de archivos inválidos, procesamiento y duplicados.
// Usa un usuario temporal (pruebas@ejemplo.test, debe estar en USUARIOS_PERMITIDOS) y limpia todo al final.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

process.loadEnvFile(".env");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = "pruebas@ejemplo.test";
const opciones = { auth: { persistSession: false, autoRefreshToken: false } };
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, opciones);
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, opciones);
const BUCKET = process.env.SUPABASE_BUCKET ?? "facturas";

let fallos = 0;
function ok(cond: boolean, msg: string): void {
  console.log(`${cond ? "OK   " : "FALLO"} ${msg}`);
  if (!cond) fallos++;
}

async function main(): Promise<void> {
  if (!(process.env.USUARIOS_PERMITIDOS ?? "").toLowerCase().includes(EMAIL)) throw new Error(`Agrega ${EMAIL} a USUARIOS_PERMITIDOS`);

  const imagenes = readdirSync("muestras")
    .filter((a) => /\.(jpe?g|png)$/i.test(a))
    .sort()
    .map((a) => readFileSync(path.join("muestras", a)));
  const hashes = imagenes.map((b) => createHash("sha256").update(b).digest("hex"));
  const previas = await admin.from("facturas").select("hash").in("hash", hashes);
  if (previas.data?.length) throw new Error("Las muestras ya están en la base (subidas desde la UI). Bórralas antes de probar.");
  const clientesAntes = new Set(((await admin.from("clientes").select("documento")).data ?? []).map((c) => c.documento as string));

  const password = randomBytes(18).toString("base64url");
  const creado = await admin.auth.admin.createUser({ email: EMAIL, password, email_confirm: true });
  if (creado.error) throw creado.error;
  const procesos: string[] = [];

  try {
    const token = (await anon.auth.signInWithPassword({ email: EMAIL, password })).data.session?.access_token;
    const api = (ruta: string, init: RequestInit = {}): Promise<Response> =>
      fetch(`${BASE}${ruta}`, { method: "POST", ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } });

    // --- Fase 3: subida ---
    const p1 = (await (await api("/api/procesos")).json()) as { id: string };
    procesos.push(p1.id);
    ok(Boolean(p1.id), `proceso creado ${p1.id}`);

    const t0 = performance.now();
    const subidas = await Promise.all(imagenes.map((b) => api(`/api/procesos/${p1.id}/imagenes`, { body: b })));
    ok(subidas.every((r) => r.status === 201), `10 imágenes subidas en ${((performance.now() - t0) / 1000).toFixed(1)} s`);

    const corrupta = await api(`/api/procesos/${p1.id}/imagenes`, { body: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), randomBytes(500)]) });
    ok(corrupta.status === 415, `JPEG corrupto (magic bytes falsos) → ${corrupta.status}`);
    const texto = await api(`/api/procesos/${p1.id}/imagenes`, { body: "no soy una imagen" });
    ok(texto.status === 415, `texto plano → ${texto.status}`);
    const vacio = await api(`/api/procesos/${p1.id}/imagenes`, { body: "" });
    ok(vacio.status === 400, `body vacío → ${vacio.status}`);
    const ajeno = await api(`/api/procesos/00000000-0000-0000-0000-000000000000/imagenes`, { body: imagenes[0] });
    ok(ajeno.status === 404, `proceso inexistente → ${ajeno.status}`);
    const sinSesion = await fetch(`${BASE}/api/procesos/${p1.id}/imagenes`, { method: "POST", body: imagenes[0] });
    ok(sinSesion.status === 401, `sin sesión → ${sinSesion.status}`);

    // --- Fase 6: procesamiento (3 llamadas en paralelo, como hará el motor de la UI) ---
    const t1 = performance.now();
    let restantes = 1;
    let llamadas = 0;
    while (restantes > 0 && llamadas < 30) {
      const respuestas = await Promise.all([1, 2, 3].map(() => api(`/api/procesos/${p1.id}/lote`)));
      llamadas += 3;
      const cuerpos = (await Promise.all(respuestas.map((r) => r.json()))) as { restantes: number }[];
      restantes = Math.min(...cuerpos.map((c) => c.restantes));
    }
    ok(restantes === 0, `cola vaciada en ${((performance.now() - t1) / 1000).toFixed(1)} s (${llamadas} llamadas a /lote)`);

    const fin = (await (await api(`/api/procesos/${p1.id}/finalizar`)).json()) as Record<string, number>;
    console.log("      resumen:", JSON.stringify(fin));
    ok(fin.total === 10 && fin.ok + fin.revision === 10 && fin.error === 0, "10 facturas procesadas sin errores");
    ok(fin.ok === 9 && fin.revision === 1, `9 ok + 1 a revisión (obtuvo ${fin.ok} + ${fin.revision})`);
    const finOtraVez = await api(`/api/procesos/${p1.id}/finalizar`);
    ok(finOtraVez.status === 200, "finalizar dos veces es idempotente");
    const subirTarde = await api(`/api/procesos/${p1.id}/imagenes`, { body: imagenes[0] });
    ok(subirTarde.status === 409, `subir a proceso finalizado → ${subirTarde.status}`);

    // --- Fase 7: Excel ---
    const rx = await fetch(`${BASE}/api/procesos/${p1.id}/excel`, { headers: { authorization: `Bearer ${token}` } });
    ok(rx.status === 200 && (rx.headers.get("content-type") ?? "").includes("spreadsheetml"), `descarga Excel → ${rx.status}`);
    const bytesExcel = Buffer.from(await rx.arrayBuffer());
    mkdirSync("salida", { recursive: true });
    writeFileSync("salida/facturas-demo.xlsx", bytesExcel);

    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(bytesExcel as unknown as ExcelJS.Buffer);
    ok(
      ["Facturas", "Ítems", "Clientes", "Resumen"].every((h) => libro.getWorksheet(h)),
      "hojas Facturas, Ítems, Clientes y Resumen",
    );
    const hf = libro.getWorksheet("Facturas")!;
    const colTotal = hf.getRow(1).values as unknown[];
    const iTotal = colTotal.indexOf("Total");
    const celdas = Array.from({ length: hf.rowCount - 2 }, (_, i) => hf.getRow(i + 2).getCell(iTotal).value);
    ok(celdas.length === 10 && celdas.every((v) => typeof v === "number"), "10 filas con Total numérico real (no texto)");
    const sumaExcel = celdas.reduce<number>((s, v) => s + Number(v), 0);
    const formula = hf.getRow(hf.rowCount).getCell(iTotal).value as { formula: string; result: number };
    const { data: filasBd } = await admin.from("facturas").select("total").eq("proceso_id", p1.id);
    const sumaBd = (filasBd ?? []).reduce((s, f) => s + Number(f.total ?? 0), 0);
    ok(sumaExcel === sumaBd && formula.result === sumaBd, `SUM(Total) Excel ${sumaExcel} = ${formula.formula} → ${formula.result} = Supabase ${sumaBd}`);
    const ajenoExcel = await fetch(`${BASE}/api/procesos/${p1.id}/excel`);
    ok(ajenoExcel.status === 401, `Excel sin sesión → ${ajenoExcel.status}`);

    // --- Idempotencia: el mismo lote otra vez ---
    const antes = (await admin.from("facturas").select("hash", { head: true, count: "exact" })).count;
    const p2 = (await (await api("/api/procesos")).json()) as { id: string };
    procesos.push(p2.id);
    const repetidas = await Promise.all(imagenes.map((b) => api(`/api/procesos/${p2.id}/imagenes`, { body: b })));
    const cuerpos = (await Promise.all(repetidas.map((r) => r.json()))) as { duplicada: boolean }[];
    ok(cuerpos.every((c) => c.duplicada), "segundo lote: las 10 marcadas como duplicadas");
    const despues = (await admin.from("facturas").select("hash", { head: true, count: "exact" })).count;
    ok(antes === despues, `0 registros repetidos (${antes} → ${despues} facturas)`);
  } finally {
    // Limpieza: facturas (cascade), imágenes, clientes nuevos y usuario temporal
    const { data } = await admin.from("facturas").select("ruta_imagen").in("proceso_id", procesos);
    if (data?.length) await admin.storage.from(BUCKET).remove(data.map((f) => f.ruta_imagen as string));
    await admin.from("procesos").delete().in("id", procesos);
    const nuevos = ((await admin.from("clientes").select("documento")).data ?? [])
      .map((c) => c.documento as string)
      .filter((d) => !clientesAntes.has(d));
    if (nuevos.length) await admin.from("clientes").delete().in("documento", nuevos);
    await admin.auth.admin.deleteUser(creado.data.user!.id);
    console.log("      limpieza hecha");
  }
  process.exit(fallos ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
