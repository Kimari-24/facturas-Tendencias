import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { usuarioActual } from "@/lib/auth";
import { listarRevision, MAX_CORREGIDAS, type FacturaLista } from "@/lib/revision";
import { EsqueletoLista } from "../_componentes/Esqueleto";
import { Nav } from "../_componentes/Nav";

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

export default function PaginaRevision() {
  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-5xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-semibold">Revisión manual</h1>
        <Suspense fallback={<EsqueletoLista />}>
          <Lista />
        </Suspense>
      </main>
    </>
  );
}

async function Lista() {
  const usuario = await usuarioActual();
  if (!usuario) redirect("/login");
  const { pendientes, corregidas } = await listarRevision(usuario.email);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Pendientes ({pendientes.length})</h2>
          {pendientes.length > 0 && (
            <Link href={`/revision/${pendientes[0].hash}`} className="btn btn--primary btn--sm">
              Empezar a corregir
            </Link>
          )}
        </div>
        {pendientes.length === 0 ? (
          <p data-testid="sin-pendientes" className="nota text-text-muted">
            <span className="text-ok">✓</span> No hay facturas por revisar.
          </p>
        ) : (
          <Tabla facturas={pendientes} accion="Corregir" />
        )}
      </section>
      {corregidas.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Corregidas manualmente ({corregidas.length})</h2>
          {corregidas.length === MAX_CORREGIDAS && <p className="text-sm text-text-muted">Se muestran las {MAX_CORREGIDAS} más recientes.</p>}
          <Tabla facturas={corregidas} accion="Ver" />
        </section>
      )}
    </div>
  );
}

function Tabla({ facturas, accion }: { facturas: FacturaLista[]; accion: string }) {
  return (
    <div className="well overflow-x-auto">
      <table className="tabla tabla--compacta">
        <thead>
          <tr>
            <th className="text-left">Número</th>
            <th className="text-left">Proveedor</th>
            <th className="text-left">Motivo</th>
            <th className="text-right">Total</th>
            <th className="w-px" />
          </tr>
        </thead>
        <tbody>
          {facturas.map((f) => (
            <tr key={f.hash}>
              <td className="lcd whitespace-nowrap">
                <Link href={`/revision/${f.hash}`} className="text-text hover:underline">
                  {f.numero ?? "Sin número"}
                </Link>
              </td>
              <td className="max-w-64 truncate">{f.proveedor ?? "Proveedor sin leer"}</td>
              <td>
                {f.estado === "ok" ? (
                  <span className="tag tag--ok">Corregida</span>
                ) : (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={`tag ${f.estado === "error" ? "tag--error" : "tag--aviso"}`}>{f.estado === "error" ? "Error" : "Revisión"}</span>
                    <span className="text-xs">
                      {f.motivos[0] ?? ""}
                      {f.motivos.length > 1 && <span className="text-text-muted"> +{f.motivos.length - 1} más</span>}
                    </span>
                  </span>
                )}
              </td>
              <td className="lcd whitespace-nowrap text-right">{f.total === null ? "—" : pesos.format(f.total)}</td>
              <td className="text-right">
                <Link href={`/revision/${f.hash}`} className="enlace whitespace-nowrap">
                  {accion}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
