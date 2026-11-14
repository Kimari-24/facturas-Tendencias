"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function BorrarDatos({ hayDatos }: { hayDatos: boolean }) {
  const router = useRouter();
  const [borrando, setBorrando] = useState(false);

  async function borrar(): Promise<void> {
    if (!window.confirm("¿Borrar TODOS tus lotes, facturas e imágenes? No se puede deshacer.")) return;
    setBorrando(true);
    await fetch("/api/datos/borrar", { method: "POST", body: JSON.stringify({ confirmar: "BORRAR" }) });
    setBorrando(false);
    router.refresh();
  }

  if (!hayDatos) return null;
  return (
    <section className="card">
      <h2 className="font-semibold text-danger">Entorno de pruebas</h2>
      <p className="mb-3 text-sm text-text-muted">Elimina tus lotes, facturas, imágenes y clientes huérfanos.</p>
      <button
        onClick={borrar}
        disabled={borrando}
        className="btn btn--sm btn--danger"
      >
        {borrando ? "Borrando…" : "Borrar datos de prueba"}
      </button>
    </section>
  );
}
