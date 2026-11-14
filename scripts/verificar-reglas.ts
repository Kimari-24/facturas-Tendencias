// Fase 2: con la llave anónima NO se debe poder leer ni escribir nada.
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const bucket = process.env.SUPABASE_BUCKET ?? "facturas";

async function main(): Promise<void> {
  let fallos = 0;
  const ok = (cond: boolean, msg: string): void => {
    console.log(`${cond ? "OK   " : "FALLO"} ${msg}`);
    if (!cond) fallos++;
  };

  for (const tabla of ["procesos", "clientes", "facturas"]) {
    const lectura = await anon.from(tabla).select("*").limit(1);
    ok(lectura.status === 401 || lectura.status === 403, `anon lee ${tabla} → ${lectura.status}`);
    const escritura = await anon.from(tabla).insert({});
    ok(escritura.status === 401 || escritura.status === 403, `anon escribe ${tabla} → ${escritura.status}`);
    const adm = await admin.from(tabla).select("*", { head: true, count: "exact" });
    ok(!adm.error, `service_role lee ${tabla} (${adm.count ?? 0} filas)`);
  }

  const subida = await anon.storage.from(bucket).upload(`prueba-anon-${Date.now()}.txt`, "x");
  ok(Boolean(subida.error), `anon sube a Storage → ${subida.error ? "rechazado" : "PERMITIDO"}`);
  const publico = await fetch(`${url}/storage/v1/object/public/${bucket}/x`);
  ok(publico.status >= 400, `URL pública del bucket → ${publico.status}`);

  process.exit(fallos ? 1 : 0);
}

void main();
