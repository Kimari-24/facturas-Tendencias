-- 005: el número de factura solo es único por proveedor, no en toda la base.
-- Antes: `numero text unique` → dos proveedores distintos con "FE-000001" chocaban y la segunda factura
-- se mandaba a revisión perdiendo su número. Ahora la unicidad es (NIT del proveedor sin DV, número).
-- El NIT se compara sin el dígito de verificación: el OCR a veces guarda "900123456-8" y a veces "900123456".
-- Si el NIT no se leyó (null) se mantiene la regla anterior para ese caso: el número no puede repetirse.
-- Ejecútalo en el SQL Editor de Supabase. Es idempotente.

create unique index if not exists facturas_nit_numero_uidx
  on public.facturas (coalesce(split_part(nit_proveedor, '-', 1), ''), numero)
  where numero is not null;

alter table public.facturas drop constraint if exists facturas_numero_key;
