"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { aExtraida, campoDelMotivo, type CampoCorregible } from "@/lib/facturas/correccion";
import type { Item } from "@/lib/facturas/extractor";
import { TARIFA_IVA, tarifaImpoconsumoCercana, validarFactura } from "@/lib/facturas/validador";
import type { FacturaRevision } from "@/lib/revision";

type Props = {
  factura: FacturaRevision & { imagenUrl: string };
  posicion: { actual: number; total: number } | null;
  siguiente: string | null;
};

type Monto = "subtotal" | "iva" | "impoconsumo" | "total";

const miles = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const pesos = (v: number): string => `$ ${miles.format(v)}`;
/** Montos en pesos: solo dígitos (los separadores de miles se ignoran). */
const aMonto = (v: string): number | null => (v.replace(/\D/g, "") === "" ? null : Number(v.replace(/\D/g, "")));
const aCantidad = (v: string): number => Number(v.replace(",", ".").replace(/[^\d.]/g, "")) || 0;
const verMonto = (v: number | null): string => (v === null ? "" : miles.format(v));

export function Editor({ factura: f, posicion, siguiente }: Props) {
  const router = useRouter();
  const [rotacion, setRotacion] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [texto, setTexto] = useState({
    numero: f.numero ?? "",
    fecha: f.fecha ?? "",
    proveedor: f.proveedor ?? "",
    nitProveedor: f.nit_proveedor ?? "",
    cliente: f.cliente ?? "",
    documentoCliente: f.documento_cliente ?? "",
  });
  const [montos, setMontos] = useState<Record<Monto, number | null>>({
    subtotal: f.subtotal,
    iva: f.iva,
    impoconsumo: f.impoconsumo,
    total: f.total,
  });
  const [items, setItems] = useState<Item[]>(f.items);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  // Validación en vivo con las mismas reglas que aplica el servidor al guardar
  const campos = { ...texto, ...montos, items };
  const motivos = validarFactura(aExtraida(campos)).motivos;
  const errores = new Map<CampoCorregible, string[]>();
  for (const m of motivos) {
    const c = campoDelMotivo(m);
    if (c) errores.set(c, [...(errores.get(c) ?? []), m]);
  }

  async function guardar(forzar: boolean): Promise<void> {
    setGuardando(true);
    setError("");
    const r = await fetch(`/api/facturas/${f.hash}/corregir`, { method: "POST", body: JSON.stringify({ ...campos, forzar }) });
    setGuardando(false);
    const datos = (await r.json()) as { guardada?: boolean; motivos?: string[]; error?: string };
    if (r.status === 422) return setAvisos(datos.motivos ?? []);
    if (!r.ok) return setError(datos.error ?? "No se pudo guardar");
    router.push(siguiente ? `/revision/${siguiente}` : "/revision");
    router.refresh();
  }

  function campoTexto(k: keyof typeof texto, etiqueta: string, tipo = "text") {
    return (
      <Campo etiqueta={etiqueta} errores={errores.get(k)}>
        {(props) => (
          <input
            {...props}
            name={k}
            type={tipo}
            value={texto[k]}
            onChange={(e) => {
              setTexto({ ...texto, [k]: e.target.value });
              setAvisos([]);
            }}
            className="input"
          />
        )}
      </Campo>
    );
  }

  function campoMonto(k: Monto, etiqueta: string) {
    return (
      <Campo etiqueta={etiqueta} errores={errores.get(k)}>
        {(props) => (
          <input
            {...props}
            name={k}
            inputMode="numeric"
            value={verMonto(montos[k])}
            onChange={(e) => {
              setMontos({ ...montos, [k]: aMonto(e.target.value) });
              setAvisos([]);
            }}
            className="input lcd text-right"
          />
        )}
      </Campo>
    );
  }

  function cambiarItem(i: number, cambio: Partial<Item>): void {
    setItems(items.map((it, j) => (j === i ? { ...it, ...cambio } : it)));
    setAvisos([]);
  }

  // Cuadre: lo que debería dar cada impuesto y el total según el subtotal escrito
  const sub = montos.subtotal ?? 0;
  const iva = montos.iva ?? 0;
  const inc = montos.impoconsumo ?? 0;
  const sumaItems = items.reduce((s, i) => s + i.total, 0);
  const restaurante = inc > 0 && iva === 0;

  return (
    <div className="space-y-4">
      {/* Encabezado: dónde estoy y qué factura es */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <Link href="/revision" className="enlace">
          ← Revisión
        </Link>
        {posicion && (
          <span className="text-text-muted">
            Pendiente {posicion.actual} de {posicion.total}
          </span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)]">
        {/* Visor */}
        <section className="lg:sticky lg:top-[64px] lg:self-start">
          <div className="visor">
            <div className="visor__barra">
              <span className="mr-auto text-xs text-text-muted">Imagen original</span>
              {[90, 180, 270].map((g) => (
                <button key={g} onClick={() => setRotacion((rotacion + g) % 360)} className="btn btn--ghost btn--sm" title={`Girar ${g}°`}>
                  ↻ {g}°
                </button>
              ))}
              <button onClick={() => setZoom(zoom === 1 ? 2 : 1)} className="btn btn--ghost btn--sm">
                {zoom === 1 ? "Ampliar" : "Reducir"}
              </button>
            </div>
            <div className="visor__lienzo">
              {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada temporal de Storage privado */}
              <img
                data-testid="imagen"
                src={f.imagenUrl}
                alt={`Factura ${f.numero ?? f.hash.slice(0, 8)}`}
                style={{ transform: `rotate(${rotacion}deg) scale(${zoom})` }}
                className="max-h-full max-w-full object-contain transition-transform"
              />
            </div>
          </div>
        </section>

        {/* Formulario */}
        <section className="space-y-5">
          <header>
            <h1 className="text-xl font-semibold">{f.numero ?? "Factura sin número"}</h1>
            <p className="text-sm text-text-muted">{f.proveedor ?? "Proveedor sin leer"}</p>
          </header>

          {f.motivos.length > 0 && (
            <div className="nota nota--aviso">
              <p className="font-semibold">Por qué llegó a revisión</p>
              <ul className="mt-1 list-inside list-disc">
                {f.motivos.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          <Seccion titulo="Factura">
            {campoTexto("numero", "Número")}
            {campoTexto("fecha", "Fecha de emisión", "date")}
          </Seccion>

          <Seccion titulo="Proveedor">
            {campoTexto("proveedor", "Razón social")}
            {campoTexto("nitProveedor", "NIT con dígito de verificación")}
          </Seccion>

          <Seccion titulo="Cliente">
            {campoTexto("cliente", "Nombre")}
            {campoTexto("documentoCliente", "NIT o cédula")}
          </Seccion>

          <Seccion titulo="Montos">
            {campoMonto("subtotal", "Subtotal")}
            {campoMonto("iva", "IVA")}
            {campoMonto("impoconsumo", "Impoconsumo")}
            {campoMonto("total", "Total")}
            <div className="col-span-full">
              <ul className="cuadre" aria-label="Cuadre de la factura">
                <Linea
                  ok={!errores.has("iva")}
                  texto={restaurante ? "IVA: no aplica (hay impoconsumo)" : `IVA 19 % del subtotal`}
                  valor={restaurante ? null : Math.round(sub * TARIFA_IVA)}
                />
                {inc > 0 && (
                  <Linea
                    ok={!errores.has("impoconsumo")}
                    texto={`Impoconsumo ${Math.round(tarifaImpoconsumoCercana(sub, inc) * 100)} % del subtotal`}
                    valor={Math.round(sub * tarifaImpoconsumoCercana(sub, inc))}
                  />
                )}
                <Linea ok={!errores.has("total") && !errores.has("subtotal")} texto="Subtotal + impuestos debe dar el total" valor={sub + iva + inc} />
                {items.length > 0 && <Linea ok={!errores.has("items")} texto="Suma de ítems debe dar el subtotal" valor={sumaItems} />}
              </ul>
            </div>
          </Seccion>

          <fieldset className="seccion">
            <legend>Ítems</legend>
            <div className="col-span-full space-y-2">
              <div className="hidden grid-cols-[4rem_1fr_7rem_7.5rem_2rem] gap-2 px-1 text-xs text-text-muted sm:grid">
                <span>Cant.</span>
                <span>Descripción</span>
                <span className="text-right">Valor unitario</span>
                <span className="text-right">Total</span>
              </div>
              {items.map((it, i) => {
                const incoherente = Math.abs(it.cantidad * it.valorUnitario - it.total) > 1;
                return (
                  <div
                    key={i}
                    data-testid="item"
                    className="grid grid-cols-[4rem_1fr_1fr_2rem] gap-2 sm:grid-cols-[4rem_1fr_7rem_7.5rem_2rem]"
                  >
                    <input aria-label="Cantidad" value={it.cantidad} onChange={(e) => cambiarItem(i, { cantidad: aCantidad(e.target.value) })} className="input input--sm lcd text-right" />
                    <input
                      aria-label="Descripción"
                      value={it.descripcion}
                      onChange={(e) => cambiarItem(i, { descripcion: e.target.value })}
                      className="input input--sm order-first col-span-full sm:order-none sm:col-span-1"
                    />
                    <input aria-label="Valor unitario" inputMode="numeric" value={verMonto(it.valorUnitario)} onChange={(e) => cambiarItem(i, { valorUnitario: aMonto(e.target.value) ?? 0 })} className="input input--sm lcd text-right" />
                    <input
                      aria-label="Total ítem"
                      aria-invalid={incoherente}
                      title={incoherente ? "Cantidad × valor unitario no da este total" : undefined}
                      inputMode="numeric"
                      value={verMonto(it.total)}
                      onChange={(e) => cambiarItem(i, { total: aMonto(e.target.value) ?? 0 })}
                      className="input input--sm lcd text-right"
                    />
                    <button
                      aria-label="Quitar ítem"
                      onClick={() => setItems(items.filter((_, j) => j !== i))}
                      className="cursor-pointer text-text-muted transition-colors hover:text-danger"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              <button onClick={() => setItems([...items, { cantidad: 1, descripcion: "", valorUnitario: 0, total: 0 }])} className="enlace text-sm">
                + Agregar ítem
              </button>
              {errores.get("items")?.map((m) => (
                <p key={m} className="text-xs text-danger">
                  {m}
                </p>
              ))}
            </div>
          </fieldset>

          {avisos.length > 0 && (
            <div data-testid="avisos" role="alert" className="nota nota--aviso">
              <p className="font-semibold">Las reglas tributarias aún no cuadran:</p>
              <ul className="mt-1 list-inside list-disc">
                {avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
              <button onClick={() => guardar(true)} disabled={guardando} className="enlace mt-2">
                Guardar de todos modos
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          {/* Barra de guardado: siempre visible al final del formulario */}
          <div className="acciones">
            <p className="mr-auto text-sm">
              {motivos.length === 0 ? (
                <span className="text-ok">✓ Todo cuadra</span>
              ) : (
                <span className="text-warning">
                  {motivos.length} {motivos.length === 1 ? "problema" : "problemas"} por resolver
                </span>
              )}
              {siguiente && <span className="block text-xs text-text-muted">Al guardar pasas a la siguiente pendiente</span>}
            </p>
            <button onClick={() => guardar(false)} disabled={guardando} className="btn btn--primary">
              {guardando ? "Guardando…" : "Guardar corrección"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="seccion">
      <legend>{titulo}</legend>
      {children}
    </fieldset>
  );
}

type PropsControl = { id: string; "aria-invalid": boolean; "aria-describedby"?: string };

function Campo({ etiqueta, errores, children }: { etiqueta: string; errores?: string[]; children: (p: PropsControl) => ReactNode }) {
  const id = useId();
  const hayError = Boolean(errores?.length);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-text-muted">
        {etiqueta}
      </label>
      {children({ id, "aria-invalid": hayError, "aria-describedby": hayError ? `${id}-e` : undefined })}
      {hayError && (
        <p id={`${id}-e`} className="mt-1 text-xs text-danger">
          {errores?.join(" · ")}
        </p>
      )}
    </div>
  );
}

function Linea({ ok, texto, valor }: { ok: boolean; texto: string; valor: number | null }) {
  return (
    <li className={ok ? "" : "cuadre--mal"}>
      <span aria-hidden="true" className={ok ? "text-ok" : "text-danger"}>
        {ok ? "✓" : "✗"}
      </span>
      <span className="flex-1">{texto}</span>
      {valor !== null && <span className="lcd">{pesos(valor)}</span>}
      <span className="sr-only">{ok ? "correcto" : "no cuadra"}</span>
    </li>
  );
}
