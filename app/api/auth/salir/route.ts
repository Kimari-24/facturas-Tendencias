import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function POST(): Promise<Response> {
  const almacen = await cookies();
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => almacen.getAll(),
      setAll: (lista) => lista.forEach(({ name, value, options }) => almacen.set(name, value, options)),
    },
  });
  await sb.auth.signOut();
  return Response.json({ ok: true });
}
