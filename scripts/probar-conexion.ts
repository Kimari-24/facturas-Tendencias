// Fase 0: comprueba Postgres, Auth y Storage de Supabase sin imprimir llaves.
import { createClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile(".env");
} catch {
  console.error("Falta .env (copia .env.example)");
  process.exit(1);
}

const requeridas = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const faltan = requeridas.filter((k) => !process.env[k]);
if (faltan.length) {
  console.error(`Faltan variables: ${faltan.join(", ")}`);
  process.exit(1);
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const bucket = process.env.SUPABASE_BUCKET ?? "facturas";

async function db(): Promise<string> {
  const { error } = await sb.from("facturas").select("hash", { head: true, count: "exact" });
  if (!error) return "Database OK";
  // PGRST205 = tabla no existe: hay conexión, falta la migración (Fase 2)
  if (error.code === "PGRST205" || error.code === "42P01") return "Database OK (sin tablas aún)";
  throw new Error(error.message);
}

async function auth(): Promise<string> {
  const { error } = await sb.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) throw new Error(error.message);
  return "Auth OK";
}

async function storage(): Promise<string> {
  const { data, error } = await sb.storage.getBucket(bucket);
  if (!error && data) return `Storage OK (bucket "${bucket}", ${data.public ? "PÚBLICO ⚠" : "privado"})`;
  const creado = await sb.storage.createBucket(bucket, { public: false, fileSizeLimit: "4MB" });
  if (creado.error) throw new Error(creado.error.message);
  return `Storage OK (bucket "${bucket}" creado, privado)`;
}

async function main(): Promise<void> {
  let fallos = 0;
  for (const [nombre, prueba] of [["Database", db], ["Auth", auth], ["Storage", storage]] as const) {
    try {
      console.log(await prueba());
    } catch (e) {
      fallos++;
      console.error(`${nombre} FALLO: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  process.exit(fallos ? 1 : 0);
}

void main();
