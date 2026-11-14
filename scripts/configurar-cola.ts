// Guarda en Supabase (tabla config_cola, migración 004) la URL y el secreto que usa el cron para llamar
// a /api/cola/procesar. El secreto se lee de COLA_SECRETO en .env y nunca se imprime.
//   npx tsx scripts/configurar-cola.ts [url]   (por defecto, producción)
import { admin } from "./_comun";

const URL_COLA = process.argv[2] ?? "https://automatizacion-sand.vercel.app/api/cola/procesar";

async function main(): Promise<void> {
  const secreto = process.env.COLA_SECRETO ?? "";
  if (secreto.length < 32) throw new Error("Falta COLA_SECRETO (mínimo 32 caracteres) en .env");
  const { error } = await admin.from("config_cola").upsert({ id: 1, url: URL_COLA, secreto });
  if (error) throw new Error(`${error.message} (¿ejecutaste la migración 004?)`);
  console.log(`Cola configurada: el cron llamará a ${URL_COLA}`);
}
void main();
