import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cliente: SupabaseClient | undefined;

/** Tiempo máximo por llamada a Supabase: si no responde, la petición falla en vez de colgar la función hasta su límite. */
const LIMITE_MS = 20_000;

const fetchConLimite: typeof fetch = (entrada, init) => {
  const limite = AbortSignal.timeout(LIMITE_MS);
  return fetch(entrada, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, limite]) : limite });
};

/** Cliente con service_role. Solo servidor: salta RLS. */
export function supabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const llave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !llave) throw new Error("Faltan variables de Supabase");
  cliente ??= createClient(url, llave, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchConLimite },
  });
  return cliente;
}

export const BUCKET = process.env.SUPABASE_BUCKET ?? "facturas";
