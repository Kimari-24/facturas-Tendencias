"use client";

import dynamic from "next/dynamic";
import { useCallback, useState, type FormEvent } from "react";

// El easter egg solo se descarga si alguien lo activa
const Huevo = dynamic(() => import("./Huevo"), { ssr: false });

/** Logo de la barra. Al hacer clic pide una palabra; con "Claude" suelta el destello. */
export function Logo() {
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(false);
  const cerrar = useCallback(() => setActivo(false), []);

  function enviar(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const palabra = String(new FormData(e.currentTarget).get("palabra") ?? "");
    setAbierto(false);
    if (palabra.trim().toLowerCase() === "claude") setActivo(true);
  }

  return (
    <div className="relative mr-2 sm:mr-6">
      <button
        type="button"
        onClick={() => setAbierto(!abierto)}
        aria-expanded={abierto}
        className="flex min-h-12 cursor-pointer items-center gap-2 font-semibold"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5 text-primary"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 2h9l5 5v15H6z" />
          <path d="M15 2v5h5M9 13h6M9 17h6" />
        </svg>
        <span className="hidden sm:inline">Facturas</span>
      </button>

      {abierto && (
        <form onSubmit={enviar} className="secreto">
          <input
            name="palabra"
            autoFocus
            autoComplete="off"
            aria-label="¿Quién anda ahí?"
            placeholder="¿Quién anda ahí?"
            onKeyDown={(e) => e.key === "Escape" && setAbierto(false)}
            onBlur={() => setAbierto(false)}
            className="input input--sm"
          />
        </form>
      )}

      {activo && <Huevo onCerrar={cerrar} />}
    </div>
  );
}
