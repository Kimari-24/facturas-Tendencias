// Textos tipo OCR. Se reemplazarán/ampliarán con la salida real de las 10 facturas (Fase 5).

/** Correcta: NIT 900123456-8 válido, IVA 19 %, ítems cuadran. */
export const FACTURA_OK = `
DISTRIBUIDORA EL ANDINO S.A.S.
NIT: 900.123.456-8
Calle 10 # 20-30 Bogotá
FACTURA ELECTRÓNICA DE VENTA No. FE-1024
Fecha de emisión: 05/10/2026
Fecha de vencimiento: 05/11/2026
Cliente: Juan Pérez Gómez
C.C. 1.020.304.050
Cant Descripción Vr. Unitario Total
2 Resma papel carta $ 20.000 $ 40.000
1 Tóner impresora 60.000 60.000
Subtotal $ 100.000
IVA 19% $ 19.000
TOTAL A PAGAR $ 119.000
`;

/** Problemas deliberados: DV del cliente erróneo, IVA 16 %, total no cuadra. */
export const FACTURA_MALA = `
FERRETERÍA LA LLAVE LTDA
N.I.T. 800.197.268-4
Factura de venta N° FV 88
Fecha: 2026-09-14
Señores: Constructora Norte
NIT 900.123.456-1
Descripción Valor Total
3 Tornillos caja 5.000 15.000
Subtotal 15.000
IVA 2.400
Total 18.000
`;

/** Restaurante con impoconsumo 4 % y sin IVA (el INC reemplaza al IVA) → ok. */
export const FACTURA_INC = `
RESTAURANTE SABOR CRIOLLO S.A.S
NIT 901.234.567-7
FACTURA No. R-77
Fecha 01-10-26
Cliente: Ana Ruiz  C.C 52.111.222
Subtotal 50,000
Impoconsumo 4% 2,000
Total 52,000
`;
