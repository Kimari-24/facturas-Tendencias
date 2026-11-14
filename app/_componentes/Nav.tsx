"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense } from "react";
import { Logo } from "./Logo";
import { BotonTema } from "./Tema";

const ENLACES = [
  { href: "/", texto: "Cargar" },
  { href: "/metricas", texto: "Métricas" },
  { href: "/revision", texto: "Revisión" },
];

// usePathname lee datos de la URL: con cacheComponents debe ir dentro de <Suspense>
export function Nav() {
  return (
    <Suspense fallback={<header className="barra h-[49px]" />}>
      <NavInterna />
    </Suspense>
  );
}

function NavInterna() {
  const ruta = usePathname();
  const router = useRouter();

  async function salir(): Promise<void> {
    await fetch("/api/auth/salir", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="barra">
      <nav className="mx-auto flex max-w-5xl flex-wrap items-center px-4">
        <Logo />
        {ENLACES.map((e) => {
          const activo = e.href === "/" ? ruta === "/" : ruta.startsWith(e.href);
          return (
            <Link key={e.href} href={e.href} aria-current={activo ? "page" : undefined} className="btn btn--sm">
              <span className="led" />
              {e.texto}
            </Link>
          );
        })}
        <BotonTema className="ml-auto" />
        <button onClick={salir} className="btn btn--sm">
          Salir
        </button>
      </nav>
    </header>
  );
}
