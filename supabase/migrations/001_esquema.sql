-- Demo 10 facturas. Todo el acceso es desde el servidor con service_role.
-- RLS activo SIN políticas + revoke = anon/authenticated no ven nada (equivale a "denegar todo").

create table if not exists public.procesos (
  id          uuid primary key default gen_random_uuid(),
  usuario     text not null,
  estado      text not null default 'subiendo' check (estado in ('subiendo','procesando','finalizado')),
  creado      timestamptz not null default now(),
  finalizado  timestamptz
);

create table if not exists public.clientes (
  documento   text primary key,             -- NIT/CC sin DV: un solo registro por cliente
  nombre      text,
  creado      timestamptz not null default now()
);

create table if not exists public.facturas (
  hash               text primary key,      -- SHA-256 de la imagen: misma imagen = misma fila
  proceso_id         uuid not null references public.procesos(id) on delete cascade,
  ruta_imagen        text not null,
  estado             text not null default 'pendiente'
                     check (estado in ('pendiente','ok','revision','error')),
  numero             text unique,           -- NULLs permitidos; si hay valor, único
  fecha              date,
  nit_proveedor      text,
  proveedor          text,
  documento_cliente  text references public.clientes(documento),
  subtotal           numeric(14,2),
  iva                numeric(14,2),
  impoconsumo        numeric(14,2),
  total              numeric(14,2),
  items              jsonb not null default '[]'::jsonb,
  motivos            text[] not null default '{}',
  texto_ocr          text,
  manual             boolean not null default false,
  creado             timestamptz not null default now(),
  actualizado        timestamptz not null default now()
);

create index if not exists facturas_proceso_idx on public.facturas (proceso_id);
create index if not exists facturas_cliente_idx on public.facturas (documento_cliente);

alter table public.procesos enable row level security;
alter table public.clientes enable row level security;
alter table public.facturas enable row level security;

revoke all on public.procesos, public.clientes, public.facturas from anon, authenticated;
