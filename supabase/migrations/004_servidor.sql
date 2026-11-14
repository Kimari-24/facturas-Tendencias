-- 004: procesamiento en el servidor y métricas en la base.
-- Ejecútalo completo en el SQL Editor de Supabase. Es idempotente (se puede correr dos veces).

-- 1) Cola en el servidor --------------------------------------------------------------------------
-- Cada minuto, pg_cron llama por HTTP (pg_net) a /api/cola/procesar de la app, que procesa las
-- facturas pendientes aunque nadie tenga la página abierta. Solo llama si hay trabajo.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- URL y secreto de la llamada. Los guarda la app (scripts/configurar-cola.ts), no van en este archivo.
create table if not exists public.config_cola (
  id       int primary key default 1 check (id = 1),
  url      text not null,
  secreto  text not null
);
alter table public.config_cola enable row level security;
revoke all on public.config_cola from anon, authenticated;

create or replace function public.disparar_cola() returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.config_cola%rowtype;
begin
  select * into c from public.config_cola where id = 1;
  if not found then return; end if;
  -- sin trabajo no hay llamada (no gasta invocaciones de Vercel)
  if not exists (select 1 from public.facturas where estado in ('pendiente', 'procesando'))
     and not exists (select 1 from public.procesos where estado <> 'finalizado') then
    return;
  end if;
  perform net.http_post(
    url := c.url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || c.secreto, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end $$;
revoke all on function public.disparar_cola() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'procesar-cola';
select cron.schedule('procesar-cola', '* * * * *', 'select public.disparar_cola()');

-- Para que el cron encuentre rápido las pendientes de cualquier proceso
create index if not exists facturas_pendientes_idx on public.facturas (creado) where estado in ('pendiente', 'procesando');

-- 2) Métricas calculadas en la base ----------------------------------------------------------------
-- Antes la app descargaba todas las facturas para sumarlas; ahora Postgres devuelve solo los totales.
create or replace function public.metricas_usuario(p_usuario text) returns jsonb
language sql stable security definer set search_path = public as $$
  with f as (
    select f.proceso_id, f.estado, f.manual, coalesce(f.total, 0) as total, coalesce(f.iva, 0) as iva,
           coalesce(f.impoconsumo, 0) as inc, f.proveedor, coalesce(f.nit_proveedor, f.proveedor, '(sin leer)') as clave
    from public.facturas f join public.procesos p on p.id = f.proceso_id
    where p.usuario = p_usuario
  )
  select jsonb_build_object(
    'facturas',    (select count(*) from f),
    'ok',          (select count(*) from f where estado = 'ok' and not manual),
    'revision',    (select count(*) from f where estado = 'revision' and not manual),
    'error',       (select count(*) from f where estado = 'error' and not manual),
    'manuales',    (select count(*) from f where manual),
    'total',       (select coalesce(sum(total), 0) from f),
    'iva',         (select coalesce(sum(iva), 0) from f),
    'impoconsumo', (select coalesce(sum(inc), 0) from f),
    'proveedores', coalesce((
      select jsonb_agg(jsonb_build_object('nombre', nombre, 'facturas', n, 'total', t) order by t desc)
      from (select coalesce(min(proveedor), '(sin leer)') as nombre, count(*) as n, sum(total) as t from f group by clave) x
    ), '[]'::jsonb),
    'procesos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'creado', p.creado, 'estado', p.estado,
        'facturas', (select count(*) from f where f.proceso_id = p.id),
        'ok',       (select count(*) from f where f.proceso_id = p.id and f.estado = 'ok' and not f.manual),
        'revision', (select count(*) from f where f.proceso_id = p.id and f.estado <> 'ok')
      ) order by p.creado desc)
      from public.procesos p where p.usuario = p_usuario
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.metricas_usuario(text) from public, anon, authenticated;
grant execute on function public.metricas_usuario(text) to service_role;
