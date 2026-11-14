// Fase 9 (UI): revisar y corregir en el navegador la factura girada.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { BASE, CORRECCION_0006 as C, EMAIL, ok, prepararEntorno, procesarMuestras, terminar } from "./_comun";

async function main(): Promise<void> {
  const e = await prepararEntorno();
  await procesarMuestras(e);
  const navegador = await chromium.launch();
  mkdirSync("salida", { recursive: true });
  try {
    const p = await navegador.newPage({ locale: "es-CO", viewport: { width: 1400, height: 1000 } });
    const errores: string[] = [];
    p.on("pageerror", (err) => errores.push(err.message));

    await p.goto(`${BASE}/login`);
    await p.fill('input[name="email"]', EMAIL);
    await p.fill('input[name="password"]', e.password);
    await p.click('button:has-text("Entrar")');
    await p.waitForURL(`${BASE}/`);

    await p.click("nav >> text=Revisión");
    await p.getByText("Pendientes (1)").waitFor();
    ok(true, "lista de revisión con 1 pendiente");
    await p.click("text=FE-000601");
    await p.waitForURL(/\/revision\/[0-9a-f]{64}$/);

    const img = p.locator('[data-testid="imagen"]');
    await img.waitFor();
    ok(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), "imagen cargada desde URL firmada");
    await p.click("text=↻ 90°");
    ok((await img.getAttribute("style"))?.includes("rotate(90deg)") ?? false, "rotar 90°");
    await p.click("text=↻ 180°");
    ok((await img.getAttribute("style"))?.includes("rotate(270deg)") ?? false, "rotar 180° más → 270°");

    for (const [k, v] of Object.entries({ ...C, impoconsumo: "", items: undefined })) {
      if (v === undefined) continue;
      await p.fill(`input[name="${k}"]`, String(v));
    }
    // Reemplazar los ítems mal leídos por los correctos
    while ((await p.locator('[data-testid="item"]').count()) > 0) await p.click('button[aria-label="Quitar ítem"] >> nth=0');
    for (const [i, it] of C.items.entries()) {
      await p.click("text=+ Agregar ítem");
      const fila = p.locator('[data-testid="item"]').nth(i);
      await fila.locator('[aria-label="Cantidad"]').fill(String(it.cantidad));
      await fila.locator('[aria-label="Descripción"]').fill(it.descripcion);
      await fila.locator('[aria-label="Valor unitario"]').fill(String(it.valorUnitario));
      await fila.locator('[aria-label="Total ítem"]').fill(String(it.total));
    }

    // Primero un IVA errado: debe avisar y no guardar
    await p.fill('input[name="iva"]', "600000");
    await p.click('button:has-text("Guardar corrección")');
    await p.locator('[data-testid="avisos"]').waitFor();
    ok((await p.locator('[data-testid="avisos"]').innerText()).includes("IVA"), "aviso de IVA incorrecto antes de guardar");
    await p.screenshot({ path: "salida/ui-revision.png" });

    await p.fill('input[name="iva"]', String(C.iva));
    await p.click('button:has-text("Guardar corrección")');
    await p.waitForURL(`${BASE}/revision`);
    await p.locator('[data-testid="sin-pendientes"]').waitFor();
    ok(true, "guardado: no quedan pendientes");
    ok(await p.getByText("Corregidas manualmente (1)").isVisible(), "aparece en 'Corregidas manualmente'");

    await p.click("nav >> text=Métricas");
    await p.locator('[data-testid="kpis"]').waitFor();
    const kpis = (await p.locator('[data-testid="kpis"]').innerText()).replace(/\s+/g, " ");
    ok(/LEÍDAS OK 9 .*A REVISIÓN 0 CORREGIDAS 1/i.test(kpis), `métricas: 9 automáticas, 0 a revisión, 1 corregida`);
    ok(errores.length === 0, `sin errores de JavaScript${errores.length ? `: ${errores.join(" | ")}` : ""}`);
  } finally {
    await navegador.close();
    await e.limpiar();
  }
  terminar();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
