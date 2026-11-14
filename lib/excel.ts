import "server-only";
import ExcelJS from "exceljs";
import type { Item } from "./facturas/extractor";
import { supabaseAdmin } from "./supabase-admin";

const PESOS = '"$"#,##0';

interface FilaFactura {
  hash: string;
  estado: string;
  numero: string | null;
  fecha: string | null;
  proveedor: string | null;
  nit_proveedor: string | null;
  documento_cliente: string | null;
  subtotal: number | null;
  iva: number | null;
  impoconsumo: number | null;
  total: number | null;
  items: Item[];
  motivos: string[];
  manual: boolean;
  clientes: { nombre: string | null } | null;
}

const num = (v: number | string | null): number => Number(v ?? 0);

function encabezado(hoja: ExcelJS.Worksheet, filtro = true): void {
  const fila = hoja.getRow(1);
  fila.font = { bold: true, color: { argb: "FFFFFFFF" } };
  fila.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  hoja.views = [{ state: "frozen", ySplit: 1 }];
  if (filtro) hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: hoja.columnCount } };
}

/** Fila de totales con fórmula SUM real (y su resultado precalculado para lectores sin motor de cálculo). */
function filaTotales(hoja: ExcelJS.Worksheet, columnas: string[], etiquetaCol: string): void {
  const ultima = hoja.rowCount;
  const fila = hoja.addRow({});
  fila.getCell(etiquetaCol).value = "TOTAL";
  for (const c of columnas) {
    const letra = hoja.getColumn(c).letter;
    let suma = 0;
    for (let r = 2; r <= ultima; r++) suma += num(hoja.getCell(`${letra}${r}`).value as number);
    fila.getCell(c).value = { formula: `SUM(${letra}2:${letra}${ultima})`, result: Math.round(suma * 100) / 100 };
  }
  fila.font = { bold: true };
}

export interface ArchivoExcel {
  nombre: string;
  bytes: Buffer;
}

export async function generarExcel(procesoId: string): Promise<ArchivoExcel> {
  const sb = supabaseAdmin();
  const [{ data: proceso, error: e1 }, { data, error: e2 }] = await Promise.all([
    sb.from("procesos").select("id, creado, estado").eq("id", procesoId).single(),
    sb
      .from("facturas")
      .select(
        "hash, estado, numero, fecha, proveedor, nit_proveedor, documento_cliente, subtotal, iva, impoconsumo, total, items, motivos, manual, clientes(nombre)",
      )
      .eq("proceso_id", procesoId)
      .order("numero"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const facturas = data as unknown as FilaFactura[];

  const libro = new ExcelJS.Workbook();
  libro.creator = "Procesador de facturas";
  libro.created = new Date();

  // --- Facturas ---
  const hf = libro.addWorksheet("Facturas");
  hf.columns = [
    { header: "Número", key: "numero", width: 13 },
    { header: "Fecha", key: "fecha", width: 12, style: { numFmt: "yyyy-mm-dd" } },
    { header: "Estado", key: "estado", width: 10 },
    { header: "Proveedor", key: "proveedor", width: 40 },
    { header: "NIT proveedor", key: "nit", width: 14 },
    { header: "Cliente", key: "cliente", width: 38 },
    { header: "Doc. cliente", key: "doc", width: 13 },
    { header: "Subtotal", key: "subtotal", width: 15, style: { numFmt: PESOS } },
    { header: "IVA", key: "iva", width: 13, style: { numFmt: PESOS } },
    { header: "Impoconsumo", key: "inc", width: 13, style: { numFmt: PESOS } },
    { header: "Total", key: "total", width: 15, style: { numFmt: PESOS } },
    { header: "Corregida", key: "manual", width: 10 },
    { header: "Motivos de revisión", key: "motivos", width: 60 },
    { header: "Hash", key: "hash", width: 18 },
  ];
  for (const f of facturas) {
    const fila = hf.addRow({
      numero: f.numero,
      fecha: f.fecha ? new Date(`${f.fecha}T00:00:00Z`) : null,
      estado: f.estado,
      proveedor: f.proveedor,
      nit: f.nit_proveedor,
      cliente: f.clientes?.nombre ?? null,
      doc: f.documento_cliente,
      subtotal: f.subtotal === null ? null : num(f.subtotal),
      iva: f.iva === null ? null : num(f.iva),
      inc: f.impoconsumo === null ? null : num(f.impoconsumo),
      total: f.total === null ? null : num(f.total),
      manual: f.manual ? "Sí" : "",
      motivos: f.motivos.join("; "),
      hash: f.hash.slice(0, 16),
    });
    if (f.estado !== "ok") fila.getCell("estado").font = { color: { argb: "FFC00000" }, bold: true };
  }
  encabezado(hf);
  filaTotales(hf, ["subtotal", "iva", "inc", "total"], "numero");

  // --- Ítems ---
  const hi = libro.addWorksheet("Ítems");
  hi.columns = [
    { header: "Factura", key: "numero", width: 13 },
    { header: "Cantidad", key: "cantidad", width: 10, style: { numFmt: "#,##0" } },
    { header: "Descripción", key: "descripcion", width: 55 },
    { header: "Valor unitario", key: "unitario", width: 15, style: { numFmt: PESOS } },
    { header: "Total", key: "total", width: 15, style: { numFmt: PESOS } },
  ];
  for (const f of facturas)
    for (const i of f.items)
      hi.addRow({ numero: f.numero, cantidad: i.cantidad, descripcion: i.descripcion, unitario: i.valorUnitario, total: i.total });
  encabezado(hi);
  filaTotales(hi, ["total"], "numero");

  // --- Clientes ---
  const porCliente = new Map<string, { nombre: string | null; facturas: number; total: number }>();
  for (const f of facturas) {
    if (!f.documento_cliente) continue;
    const c = porCliente.get(f.documento_cliente) ?? { nombre: f.clientes?.nombre ?? null, facturas: 0, total: 0 };
    c.facturas++;
    c.total += num(f.total);
    porCliente.set(f.documento_cliente, c);
  }
  const hc = libro.addWorksheet("Clientes");
  hc.columns = [
    { header: "Documento", key: "doc", width: 14 },
    { header: "Nombre", key: "nombre", width: 42 },
    { header: "Facturas", key: "facturas", width: 10 },
    { header: "Total comprado", key: "total", width: 16, style: { numFmt: PESOS } },
  ];
  for (const [doc, c] of porCliente) hc.addRow({ doc, ...c });
  encabezado(hc);

  // --- Resumen ---
  const hr = libro.addWorksheet("Resumen");
  hr.columns = [
    { header: "Concepto", key: "k", width: 34 },
    { header: "Valor", key: "v", width: 18 },
  ];
  const cuenta = (e: string): number => facturas.filter((f) => f.estado === e).length;
  const suma = (k: "subtotal" | "iva" | "impoconsumo" | "total"): number => facturas.reduce((s, f) => s + num(f[k]), 0);
  hr.addRows([
    { k: "Proceso", v: proceso.id },
    { k: "Creado", v: new Date(proceso.creado as string) },
    { k: "Estado del proceso", v: proceso.estado },
    { k: "Facturas", v: facturas.length },
    { k: "Leídas automáticamente (ok)", v: facturas.filter((f) => f.estado === "ok" && !f.manual).length },
    { k: "A revisión", v: cuenta("revision") },
    { k: "Con error", v: cuenta("error") },
    { k: "Corregidas manualmente", v: facturas.filter((f) => f.manual).length },
  ]);
  hr.getCell("B3").numFmt = "yyyy-mm-dd hh:mm";
  for (const [k, campo] of [
    ["Subtotal", "subtotal"],
    ["IVA", "iva"],
    ["Impoconsumo", "impoconsumo"],
    ["Total facturado", "total"],
  ] as const) {
    hr.addRow({ k, v: suma(campo) }).getCell("v").numFmt = PESOS;
  }
  hr.addRow({});
  hr.addRow({ k: "Total por proveedor", v: "" }).font = { bold: true };
  const porProveedor = new Map<string, { nombre: string; total: number }>(); // por NIT
  for (const f of facturas) {
    const clave = f.nit_proveedor ?? f.proveedor ?? "(sin leer)";
    const p = porProveedor.get(clave) ?? { nombre: f.proveedor ?? "(sin leer)", total: 0 };
    p.total += num(f.total);
    porProveedor.set(clave, p);
  }
  for (const p of [...porProveedor.values()].sort((a, b) => b.total - a.total))
    hr.addRow({ k: p.nombre, v: p.total }).getCell("v").numFmt = PESOS;
  encabezado(hr, false);

  const bytes = Buffer.from(await libro.xlsx.writeBuffer());
  return { nombre: `facturas-${procesoId.slice(0, 8)}.xlsx`, bytes };
}
