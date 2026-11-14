// Fase 8: E2E en navegador real. Login → subir 10 facturas → motor → Excel → métricas → borrar → salir.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

process.loadEnvFile(".env");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = "pruebas@ejemplo.test";
const TOTAL_ESPERADO = 103705157;
const LOG_DEV = ".next/dev/logs/next-development.log"; // solo existe con next dev local
const opciones = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, opciones);

let fallos = 0;
function ok(cond: boolean, msg: string): void {
  console.log(`${cond ? "OK   " : "FALLO"} ${msg}`);
  if (!cond) fallos++;
}
const digitos = (t: string | null): number => Number((t ?? "").replace(/\D/g, ""));

async function main(): Promise<void> {
  const rutas = readdirSync("muestras")
    .filter((a) => /\.(jpe?g|png)$/i.test(a))
    .sort()
    .map((a) => path.resolve("muestras", a));
  const hashes = rutas.map((r) => createHash("sha256").update(readFileSync(r)).digest("hex"));
  if ((await admin.from("facturas").select("hash").in("hash", hashes)).data?.length)
    throw new Error("Las muestras ya están en la base. Bórralas desde /metricas antes de probar.");

  const password = randomBytes(18).toString("base64url");
  const creado = await admin.auth.admin.createUser({ email: EMAIL, password, email_confirm: true });
  if (creado.error) throw creado.error;
  const inicioLog = existsSync(LOG_DEV) ? statSync(LOG_DEV).size : 0;
  const navegador = await chromium.launch();
  mkdirSync("salida", { recursive: true });

  try {
    const pagina = await navegador.newPage({ acceptDownloads: true, locale: "es-CO" });
    const errores: string[] = [];
    pagina.on("pageerror", (e) => errores.push(e.message));

    await pagina.goto(BASE);
    ok(pagina.url().endsWith("/login"), "sin sesión redirige a /login");

    await pagina.fill('input[name="email"]', EMAIL);
    await pagina.fill('input[name="password"]', password);
    await pagina.click('button:has-text("Entrar")');
    await pagina.waitForURL(`${BASE}/`);
    ok(true, "login correcto");

    await pagina.setInputFiles('[data-testid="archivos"]', rutas);
    ok(await pagina.getByText("10 imágenes seleccionadas").isVisible(), "10 imágenes seleccionadas");

    const t0 = performance.now();
    await pagina.click('button:has-text("Iniciar")');
    const resumen = pagina.locator('[data-testid="resumen"]');
    await resumen.waitFor({ timeout: 180_000 });
    const texto = (await resumen.innerText()).replace(/\s+/g, " ");
    console.log(`      resumen UI: ${texto.slice(0, 140)}`);
    ok(/Facturas 10 Correctas 9 A revisión 1/i.test(texto), `UI muestra 10 / 9 ok / 1 revisión (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
    ok(texto.includes("103.705.157"), "UI muestra total $103.705.157");
    await pagina.screenshot({ path: "salida/ui-carga.png", fullPage: true });

    const [descarga] = await Promise.all([pagina.waitForEvent("download"), pagina.click("text=Descargar Excel")]);
    const destino = path.resolve("salida", descarga.suggestedFilename());
    await descarga.saveAs(destino);
    ok(statSync(destino).size > 5000, `Excel descargado desde la UI (${descarga.suggestedFilename()})`);

    await pagina.click("nav >> text=Métricas");
    await pagina.waitForURL(`${BASE}/metricas`);
    await pagina.locator('[data-testid="total"]').waitFor();
    ok(digitos(await pagina.locator('[data-testid="total"]').innerText()) === TOTAL_ESPERADO, "métricas: total acumulado = $103.705.157");
    const proveedores = await pagina.locator("table").first().locator("tbody tr").count();
    ok(proveedores === 8, `métricas: 8 proveedores agrupados por NIT (obtuvo ${proveedores})`);
    await pagina.screenshot({ path: "salida/ui-metricas.png", fullPage: true });

    pagina.once("dialog", (d) => void d.accept());
    await pagina.click('button:has-text("Borrar datos de prueba")');
    await pagina.getByText("Aún no hay facturas procesadas.").waitFor({ timeout: 30_000 });
    const quedan = await admin.from("procesos").select("id", { head: true, count: "exact" }).eq("usuario", EMAIL);
    ok(quedan.count === 0, "borrar datos: 0 lotes en Supabase");

    await pagina.click('button:has-text("Salir")');
    await pagina.waitForURL(`${BASE}/login`);
    ok(true, "cerrar sesión vuelve a /login");
    ok(errores.length === 0, `sin errores de JavaScript en la página${errores.length ? `: ${errores.join(" | ")}` : ""}`);
    if (existsSync(LOG_DEV)) {
      const nuevos = readFileSync(LOG_DEV, "utf8").slice(inicioLog).split("\n").filter((l) => l.includes('"level":"ERROR"'));
      ok(nuevos.length === 0, `sin errores en el log de next dev${nuevos.length ? `: ${nuevos[0].slice(0, 200)}` : ""}`);
    }
  } finally {
    await navegador.close();
    const { data } = await admin.from("procesos").select("id").eq("usuario", EMAIL);
    const ids = (data ?? []).map((p) => p.id as string);
    if (ids.length) {
      const { data: f } = await admin.from("facturas").select("ruta_imagen").in("proceso_id", ids);
      if (f?.length) await admin.storage.from(process.env.SUPABASE_BUCKET ?? "facturas").remove(f.map((x) => x.ruta_imagen as string));
      await admin.from("procesos").delete().in("id", ids);
    }
    await admin.auth.admin.deleteUser(creado.data.user!.id);
    console.log("      limpieza hecha · capturas en salida/");
  }
  process.exit(fallos ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
