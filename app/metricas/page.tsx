import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { usuarioActual } from "@/lib/auth";
import { obtenerMetricas } from "@/lib/metricas";
import { EsqueletoMetricas } from "../_componentes/Esqueleto";
import { Nav } from "../_componentes/Nav";
import { BorrarDatos } from "./BorrarDatos";

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const fecha = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" });

export default function PaginaMetricas() {
  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-5xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-semibold">Métricas</h1>
        <Suspense fallback={<EsqueletoMetricas />}>
          <Tablero />
        </Suspense>
      </main>
    </>
  );
}

async function Tablero() {
  const usuario = await usuarioActual();
  if (!usuario) redirect("/login");
  const m = await obtenerMetricas(usuario.email);
  const tasa = m.facturas ? Math.round((m.ok / m.facturas) * 100) : 0;
  const aRevisar = m.revision + m.error;
  const mayor = Math.max(1, ...m.proveedores.map((p) => p.total));

  return (
    <div className="space-y-8">
      {/* Cabecera: una cifra principal y el resto como datos de apoyo */}
      <dl data-testid="kpis" className="cabecera-metricas">
        <div>
          <dt className="text-sm text-text-muted">Total facturado</dt>
          <dd data-testid="total" className="lcd text-3xl sm:text-4xl">
            {pesos.format(m.total)}
          </dd>
          <dd className="mt-1 text-sm text-text-muted">
            IVA <span className="lcd text-text">{pesos.format(m.iva)}</span>
            {m.impoconsumo > 0 && (
              <>
                {" "}
                · Impoconsumo <span className="lcd text-text">{pesos.format(m.impoconsumo)}</span>
              </>
            )}
          </dd>
        </div>
        <div className="space-y-3">
          <div>
            <dt className="text-sm text-text-muted">Lectura automática</dt>
            <dd className="flex items-center gap-3">
              <span className="lcd text-2xl">{tasa} %</span>
              <span className="pista w-40" aria-hidden="true">
                <span className="block h-full bg-ok" style={{ width: `${tasa}%` }} />
              </span>
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <Dato titulo="Facturas" valor={m.facturas} />
            <Dato titulo="Leídas OK" valor={m.ok} />
            <Dato titulo="A revisión" valor={aRevisar} tono={aRevisar ? "text-warning" : ""} />
            <Dato titulo="Corregidas" valor={m.manuales} />
          </div>
          {aRevisar > 0 && (
            <Link href="/revision" className="enlace text-sm">
              Corregir {aRevisar} {aRevisar === 1 ? "factura pendiente" : "facturas pendientes"} →
            </Link>
          )}
        </div>
      </dl>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Por proveedor</h2>
        {m.proveedores.length === 0 ? (
          <p className="text-sm text-text-muted">Aún no hay facturas procesadas.</p>
        ) : (
          <div className="well overflow-x-auto">
            <table className="tabla tabla--compacta">
              <thead>
                <tr>
                  <th className="text-left">Proveedor</th>
                  <th className="text-right">Facturas</th>
                  <th className="text-right">Total</th>
                  <th className="hidden w-48 text-left sm:table-cell">Participación</th>
                </tr>
              </thead>
              <tbody>
                {m.proveedores.map((p) => (
                  <tr key={p.nombre + p.total}>
                    <td className="max-w-72 truncate text-text">{p.nombre}</td>
                    <td className="lcd text-right">{p.facturas}</td>
                    <td className="lcd whitespace-nowrap text-right">{pesos.format(p.total)}</td>
                    <td className="hidden sm:table-cell">
                      <span className="flex items-center gap-2">
                        <span className="h-2 flex-1">
                          <span className="block h-full bg-primary" style={{ width: `${Math.max(2, Math.round((p.total / mayor) * 100))}%` }} />
                        </span>
                        <span className="w-9 whitespace-nowrap text-right text-xs">{m.total ? Math.round((p.total / m.total) * 100) : 0} %</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Lotes</h2>
        {m.procesos.length === 0 ? (
          <p className="text-sm text-text-muted">Sin lotes.</p>
        ) : (
          <div className="well overflow-x-auto">
            <table className="tabla tabla--compacta">
              <thead>
                <tr>
                  <th className="text-left">Fecha</th>
                  <th className="text-left">Estado</th>
                  <th className="text-right">Facturas</th>
                  <th className="text-right">Correctas</th>
                  <th className="text-right">A revisión</th>
                  <th className="w-px" />
                </tr>
              </thead>
              <tbody>
                {m.procesos.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap text-text">{fecha.format(new Date(p.creado))}</td>
                    <td>
                      <span className={`tag ${p.estado === "finalizado" ? "" : "tag--aviso"}`}>{ESTADOS[p.estado] ?? p.estado}</span>
                    </td>
                    <td className="lcd text-right">{p.facturas}</td>
                    <td className="lcd text-right">{p.ok}</td>
                    <td className={`lcd text-right ${p.revision ? "text-warning" : ""}`}>{p.revision}</td>
                    <td className="text-right">
                      {p.facturas > 0 && (
                        <a href={`/api/procesos/${p.id}/excel`} className="enlace whitespace-nowrap">
                          Excel
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <BorrarDatos hayDatos={m.procesos.length > 0} />
    </div>
  );
}

const ESTADOS: Record<string, string> = { subiendo: "Subiendo", procesando: "Procesando", finalizado: "Finalizado" };

function Dato({ titulo, valor, tono = "" }: { titulo: string; valor: number; tono?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-text-muted">{titulo}</dt>
      <dd className={`lcd ${tono}`}>{valor}</dd>
    </div>
  );
}
