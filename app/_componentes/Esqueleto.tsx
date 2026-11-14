/** Esqueletos de carga: muestran la forma real de la página mientras llegan los datos (no un "Cargando…" vacío). */

function Bloque({ className = "" }: { className?: string }) {
  return <div className={`esqueleto ${className}`} />;
}

export function EsqueletoMetricas() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Cargando métricas">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="card space-y-3">
            <Bloque className="h-3 w-20" />
            <Bloque className="h-6 w-32" />
          </div>
        ))}
      </div>
      {[3, 1].map((filas, i) => (
        <div key={i} className="space-y-3">
          <Bloque className="h-5 w-40" />
          <div className="well">
            {Array.from({ length: filas + 1 }, (_, j) => (
              <div key={j} className="flex h-12 items-center border-t border-surface-strong px-4 first:border-t-0">
                <Bloque className="h-3 w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function EsqueletoLista() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Cargando facturas">
      <Bloque className="mb-1 h-5 w-40" />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="card space-y-3">
          <div className="flex justify-between gap-4">
            <Bloque className="h-4 w-64 max-w-[60%]" />
            <Bloque className="h-4 w-24" />
          </div>
          <Bloque className="h-3 w-48" />
        </div>
      ))}
    </div>
  );
}

export function EsqueletoEditor() {
  return (
    <div className="grid gap-6 lg:grid-cols-2" aria-busy="true" aria-label="Cargando factura">
      <div className="space-y-3">
        <Bloque className="h-8 w-full" />
        <Bloque className="aspect-[4/5] w-full" />
      </div>
      <div className="card space-y-4 self-start">
        <Bloque className="h-6 w-40" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Bloque className="h-3 w-20" />
              <Bloque className="h-8 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
