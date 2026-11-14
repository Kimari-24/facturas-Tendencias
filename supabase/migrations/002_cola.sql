-- Estado intermedio para reclamar facturas sin que dos invocaciones procesen la misma.
alter table public.facturas drop constraint if exists facturas_estado_check;
alter table public.facturas
  add constraint facturas_estado_check
  check (estado in ('pendiente','procesando','ok','revision','error'));

-- Para reclamar rápido las pendientes de un proceso
create index if not exists facturas_cola_idx on public.facturas (proceso_id, estado);
