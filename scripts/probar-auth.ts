// Fase A: sin sesión → 401; usuario válido pero NO autorizado → 403.
// Crea un usuario temporal con contraseña aleatoria y lo borra al terminar.
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const opciones = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, opciones);
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, opciones);

async function main(): Promise<void> {
  let fallos = 0;
  const ok = (cond: boolean, msg: string): void => {
    console.log(`${cond ? "OK   " : "FALLO"} ${msg}`);
    if (!cond) fallos++;
  };

  const sin = await fetch(`${BASE}/api/yo`);
  ok(sin.status === 401, `sin sesión → ${sin.status}`);

  const falso = await fetch(`${BASE}/api/yo`, { headers: { authorization: "Bearer token.falso.x" } });
  ok(falso.status === 401, `token inválido → ${falso.status}`);

  const email = `intruso-${Date.now()}@ejemplo.test`;
  const password = randomBytes(18).toString("base64url");
  const creado = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (creado.error || !creado.data.user) throw new Error(creado.error?.message ?? "no se creó usuario");
  try {
    const sesion = await anon.auth.signInWithPassword({ email, password });
    const token = sesion.data.session?.access_token;
    ok(Boolean(token), "usuario temporal inicia sesión");
    const r = await fetch(`${BASE}/api/yo`, { headers: { authorization: `Bearer ${token}` } });
    ok(r.status === 403, `usuario no autorizado → ${r.status}`);
  } finally {
    await admin.auth.admin.deleteUser(creado.data.user.id);
  }

  const pagina = await fetch(`${BASE}/`, { redirect: "manual" });
  const destino = pagina.headers.get("location") ?? "";
  ok(pagina.status === 307 && destino.includes("/login"), `página sin sesión → ${pagina.status} a /login`);

  process.exit(fallos ? 1 : 0);
}

void main();
