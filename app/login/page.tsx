"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { BotonTema } from "../_componentes/Tema";
import { Animacion } from "./Animacion";

const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

export default function Login() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  async function entrar(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setCargando(true);
    setError("");
    const datos = new FormData(e.currentTarget);
    const { error } = await sb.auth.signInWithPassword({
      email: String(datos.get("email")),
      password: String(datos.get("password")),
    });
    setCargando(false);
    if (error) return setError("Correo o contraseña incorrectos");
    const yo = await fetch("/api/yo");
    if (yo.status === 403) {
      await sb.auth.signOut();
      return setError("Tu correo no está autorizado");
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Panel ilustrado: solo en pantallas grandes */}
      <section className="hidden flex-col items-center justify-center gap-6 bg-surface p-12 lg:flex">
        <Animacion />
        <div className="max-w-sm text-center">
          <p className="text-lg font-semibold">Tus facturas, leídas y cuadradas</p>
          <p className="mt-1 text-sm text-text-muted">Sube las imágenes, revisa el IVA y los totales, y descarga todo en Excel.</p>
        </div>
      </section>

      <div className="relative flex items-center justify-center p-4">
        <BotonTema className="btn--ghost absolute top-4 right-4" />
        <form onSubmit={entrar} className="w-full max-w-sm space-y-4">
          <h1 className="text-xl font-semibold">Procesador de facturas</h1>
          <p className="text-sm text-text-muted">Inicia sesión con tu correo autorizado.</p>
          <label className="block">
            <span className="mb-1 block text-xs text-text-muted">Correo</span>
            <input name="email" type="email" required autoComplete="email" className="input" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-text-muted">Contraseña</span>
            <input name="password" type="password" required autoComplete="current-password" className="input" />
          </label>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <button disabled={cargando} className="btn btn--primary w-full">
            {cargando ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}
