import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export interface Usuario {
  id: string;
  email: string;
}

const URL_SB = (): string => process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = (): string => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function permitidos(): Set<string> {
  return new Set(
    (process.env.USUARIOS_PERMITIDOS ?? "")
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean),
  );
}

function leerCookies(request: Request): { name: string; value: string }[] {
  const cabecera = request.headers.get("cookie") ?? "";
  return cabecera
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf("=");
      return { name: p.slice(0, i), value: decodeURIComponent(p.slice(i + 1)) };
    });
}

/** Para Server Components: usuario autorizado de la cookie, o null. */
export async function usuarioActual(): Promise<Usuario | null> {
  const { connection } = await import("next/server");
  const { cookies } = await import("next/headers");
  await connection(); // con cacheComponents: render en cada petición (getClaims usa Date.now)
  const cabecera = (await cookies())
    .getAll()
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join("; ");
  const r = await exigirUsuario(new Request("http://local", { headers: { cookie: cabecera } }));
  return r instanceof Response ? null : r;
}

/**
 * Devuelve el usuario o una Response 401/403 lista para retornar.
 * Acepta cookie de sesión (navegador) o `Authorization: Bearer` (scripts de prueba).
 * getClaims verifica la firma del JWT; con llaves asimétricas no llama a la red.
 */
export async function exigirUsuario(request: Request): Promise<Usuario | Response> {
  const bearer = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];

  const sb = bearer
    ? createClient(URL_SB(), ANON(), { auth: { persistSession: false, autoRefreshToken: false } })
    : createServerClient(URL_SB(), ANON(), {
        cookies: { getAll: () => leerCookies(request), setAll: () => {} },
      });

  const { data, error } = await sb.auth.getClaims(bearer);
  const claims = data?.claims;
  if (error || !claims?.sub) return Response.json({ error: "No autenticado" }, { status: 401 });

  const email = String(claims.email ?? "").toLowerCase();
  if (!permitidos().has(email)) return Response.json({ error: "Usuario no autorizado" }, { status: 403 });

  return { id: claims.sub, email };
}
