-- 003: índice para las consultas por usuario (métricas y revisión filtran por procesos.usuario).
-- Ejecútalo en el SQL Editor de Supabase. Es idempotente.
create index if not exists procesos_usuario_idx on public.procesos (usuario, creado desc);
