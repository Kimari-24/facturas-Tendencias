// Utilidades de las pruebas: usuario temporal autorizado, procesar muestras por HTTP y limpieza.
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

process.loadEnvFile(".env");
export const BASE = process.env.BASE_URL ?? "http://localhost:3000";
export const EMAIL = "pruebas@ejemplo.test";
const BUCKET = process.env.SUPABASE_BUCKET ?? "facturas";
const opciones = { auth: { persistSession: false, autoRefreshToken: false } };
export const admin: SupabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, opciones);

let fallos = 0;
export function ok(cond: boolean, msg: string): void {
  console.log(`${cond ? "OK   " : "FALLO"} ${msg}`);
  if (!cond) fallos++;
}
export const terminar = (): never => process.exit(fallos ? 1 : 0);

export const rutasMuestras = (): string[] =>
  readdirSync("muestras")
    .filter((a) => /\.(jpe?g|png)$/i.test(a))
    .sort()
    .map((a) => path.resolve("muestras", a));

export interface Entorno {
  password: string;
  token: string;
  api: (ruta: string, init?: RequestInit) => Promise<Response>;
  limpiar: () => Promise<void>;
}

export async function prepararEntorno(): Promise<Entorno> {
  if (!(process.env.USUARIOS_PERMITIDOS ?? "").toLowerCase().includes(EMAIL)) throw new Error(`Agrega ${EMAIL} a USUARIOS_PERMITIDOS`);
  const hashes = rutasMuestras().map((r) => createHash("sha256").update(readFileSync(r)).digest("hex"));
  if ((await admin.from("facturas").select("hash").in("hash", hashes)).data?.length)
    throw new Error("Las muestras ya están en la base. Bórralas desde /metricas antes de probar.");

  const clientesAntes = new Set(((await admin.from("clientes").select("documento")).data ?? []).map((c) => c.documento as string));
  const password = randomBytes(18).toString("base64url");
  const creado = await admin.auth.admin.createUser({ email: EMAIL, password, email_confirm: true });
  if (creado.error) throw creado.error;
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, opciones);
  const token = (await anon.auth.signInWithPassword({ email: EMAIL, password })).data.session?.access_token ?? "";

  return {
    password,
    token,
    api: (ruta, init = {}) =>
      fetch(`${BASE}${ruta}`, { method: "POST", ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } }),
    limpiar: async () => {
      const { data } = await admin.from("procesos").select("id").eq("usuario", EMAIL);
      const ids = (data ?? []).map((p) => p.id as string);
      if (ids.length) {
        const { data: f } = await admin.from("facturas").select("ruta_imagen").in("proceso_id", ids);
        if (f?.length) await admin.storage.from(BUCKET).remove(f.map((x) => x.ruta_imagen as string));
        await admin.from("procesos").delete().in("id", ids);
      }
      const nuevos = ((await admin.from("clientes").select("documento")).data ?? [])
        .map((c) => c.documento as string)
        .filter((d) => !clientesAntes.has(d));
      if (nuevos.length) await admin.from("clientes").delete().in("documento", nuevos);
      await admin.auth.admin.deleteUser(creado.data.user!.id);
      console.log("      limpieza hecha");
    },
  };
}

/** Sube y procesa las 10 muestras; devuelve el id del proceso. */
export async function procesarMuestras(e: Entorno): Promise<string> {
  const { id } = (await (await e.api("/api/procesos")).json()) as { id: string };
  await Promise.all(rutasMuestras().map((r) => e.api(`/api/procesos/${id}/imagenes`, { body: readFileSync(r) })));
  for (let restantes = 1, n = 0; restantes > 0 && n < 10; n++) {
    const rs = await Promise.all([1, 2, 3].map(() => e.api(`/api/procesos/${id}/lote`)));
    restantes = Math.min(...((await Promise.all(rs.map((r) => r.json()))) as { restantes: number }[]).map((c) => c.restantes));
  }
  await e.api(`/api/procesos/${id}/finalizar`);
  return id;
}

/** Datos correctos de factura_0006 (leídos a mano de la imagen). */
export const CORRECCION_0006 = {
  numero: "FE-000601",
  fecha: "2026-10-01",
  proveedor: "Ferrosuministros Ozuna Palomino S.A.S.",
  nitProveedor: "820.834.810-3",
  cliente: "Agroindustrias Moya Lozada S.A.S.",
  documentoCliente: "872.621.206-9",
  subtotal: 3270800,
  iva: 621452,
  impoconsumo: null,
  total: 3892252,
  items: [
    { cantidad: 13, descripcion: "Casco de seguridad con suspensión de 4 puntos", valorUnitario: 32600, total: 423800 },
    { cantidad: 23, descripcion: "Guantes de seguridad de carnaza par", valorUnitario: 11700, total: 269100 },
    { cantidad: 6, descripcion: "Caja de tornillos autoperforantes x 100 unidades", valorUnitario: 10500, total: 63000 },
    { cantidad: 101, descripcion: "Varilla corrugada 3/8 pulgada x 6 metros", valorUnitario: 24900, total: 2514900 },
  ],
};
