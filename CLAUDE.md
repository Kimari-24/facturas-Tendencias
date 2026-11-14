# CLAUDE.md — Procesador de facturas (Next.js + OCR + Supabase + Excel)

Eres Claude Code actuando como un **Senior Software Engineer pragmático y directo**: escribe el código que funciona, explica brevemente el porqué de cada decisión de arquitectura y cierra con un resumen claro de lo que hiciste.

**Alcance: uso real de hasta ~500 facturas/mes (fotos o escaneos), solo con planes gratuitos.** Ya no es demo, pero el usuario quiere gastar poco límite: respuestas y cambios cortos, sin sobre-ingeniería para miles de facturas. **No subas facturas a Supabase/producción sin permiso explícito**: verifica con pruebas locales que no suban nada.

---

## 1. Modo de trabajo

1. **Directo al grano**: escribe el código, aplícalo y verifícalo con ejecuciones reales.
2. **Explicación justa**: di brevemente **por qué** (límites de Vercel, idempotencia, seguridad, consumo).
3. **Resumen de cierre**: qué hiciste, qué archivos tocaste y la salida real de la verificación.
4. **Validación honesta**: nunca modifiques un test para forzar un "pass"; arregla la causa raíz.

## 2. Reglas

1. **TypeScript estricto sin `any`.**
2. **`.env` nunca se lee ni se imprime.** Para ver nombres de variables: `grep -v '^#' .env | cut -d= -f1`. Para usar valores, pásalos por tubería (p. ej. `node -e "process.loadEnvFile('.env'); process.stdout.write(process.env.X)" | npx vercel env add X production`).
3. **Límites de Vercel Hobby**: 4.5 MB de body (usamos máx. 4 MB por imagen), filesystem de solo lectura salvo `/tmp`, logs retenidos solo 30 min.
4. **Next.js 16** (lee `node_modules/next/dist/docs/` antes de usar APIs que no conozcas; ver `AGENTS.md`):
   - `proxy.ts` (raíz) en lugar de `middleware.ts`.
   - `params` es `Promise`; usa los tipos globales `PageProps<"/ruta">` y `RouteContext<"/ruta">` (regenera con `npx next typegen`).
   - `cacheComponents: true`: todo lo que lea cookies/sesión debe ir dentro de `<Suspense>` y tras `await connection()` (ya lo hace `usuarioActual()`). Lo mismo para `usePathname()` en componentes cliente (ver `Nav.tsx`).
5. **Seguridad Supabase**: las tablas tienen RLS activo **sin políticas** y `revoke` a `anon`/`authenticated`. Todo acceso a datos va por el servidor con `service_role` (`lib/supabase-admin.ts`, marcado `server-only`). Nunca expongas esa llave al cliente.

---

## 3. Pila (versiones instaladas)

| Pieza | Elección | Nota |
|---|---|---|
| Hosting | **Vercel** Hobby, Node 24 (`engines.node: 24.x`) | Producción: https://automatizacion-sand.vercel.app (región iad1). Sin Git conectado: se despliega con `npx vercel deploy --prod`. |
| Framework | **Next.js 16.4.5**, App Router, React 19.3 | API con Route Handlers. Sin carpeta `src/`. |
| Base de datos | **Supabase Postgres** (`@supabase/supabase-js` 2.119) | Unicidad e idempotencia con llaves primarias / `UNIQUE`. |
| Auth | **Supabase Auth** (`@supabase/ssr` 0.12) | Email + contraseña, cookie de sesión; lista blanca `USUARIOS_PERMITIDOS`. |
| Almacén | **Supabase Storage**, bucket privado `facturas` | Imágenes como `{sha256}.{ext}`; visor con URL firmada de 10 min. |
| OCR | `tesseract.js` 7.0.0 + `@tesseract.js-data/spa` | Idioma desde `node_modules`, `cacheMethod: "none"`. |
| Imagen | `sharp` 0.35.5 | Validación por magic bytes, rotación EXIF, preprocesado. |
| Excel | `exceljs` 4.4.0 | Generado al vuelo en cada descarga (no se guarda). |
| Pruebas | `vitest` 5 · `playwright` (Chromium) | Unitarias + scripts HTTP/E2E en `scripts/`. |

---

## 4. Arquitectura

```
navegador (Motor.tsx)                 Vercel (Route Handlers)                    Supabase
1. POST /api/procesos ───────────────► crea proceso ───────────────────────────► procesos
2. 1 imagen por petición (4 a la vez)► /imagenes: sesión, ≤4 MB, magic bytes,
                                       SHA-256 (duplicada → no se sube) ────────► Storage + facturas(pendiente)
3. 3 trabajadores en bucle ──────────► /lote: reclama 2 facturas (UPDATE
                                       condicional), OCR → extraer → validar ───► facturas(ok|revision|error), clientes
4. POST /finalizar ──────────────────► cierra (idempotente; 409 si hay pendientes)
5. GET /excel ◄────────────────────── genera xlsx al vuelo (4 hojas)
   /metricas, /revision ◄──────────── agregados con 2 consultas · corrección manual
```

### Archivos clave
- `lib/facturas/` — lógica pura y testeada: `nit.ts` (DV DIAN), `numeros.ts` (montos y fechas, incl. "16 de octubre de 2026"), `extractor.ts` (5 diseños de factura), `validador.ts` (IVA 19 %, impoconsumo 4 %, totales, ítems).
- `lib/ocr/motor.ts` — worker de Tesseract reutilizado; intentos original → preprocesado → invertido 180°; se detiene en el primero `ok`. Tiempo máximo: 25 s para iniciar y 20 s por imagen (si el worker muere, tesseract.js no rechaza la promesa).
- `lib/procesos.ts` — crear, subir, reclamar, guardar, finalizar, resumen. `ErrorHttp` + `responderError`.
- `lib/excel.ts` — hojas Facturas, Ítems, Clientes y Resumen; montos numéricos `"$"#,##0`, fórmulas `SUM` con resultado precalculado.
- `lib/metricas.ts`, `lib/revision.ts` (`corregirFactura`), `lib/auth.ts` (`exigirUsuario`, `usuarioActual`).
- `app/_componentes/Motor.tsx` (carga + motor), `Nav.tsx`; páginas `/`, `/login`, `/metricas`, `/revision`, `/revision/[hash]`.
- `proxy.ts` — refresca la cookie y manda a `/login` las páginas sin sesión (las `/api` responden 401/403 por su cuenta).

### Modelo de datos (`supabase/migrations/`, se ejecutan a mano en el SQL Editor)
- `001_esquema.sql` — `procesos`, `clientes(documento PK)`, `facturas(hash PK, numero UNIQUE, items jsonb, motivos text[], manual bool…)`, RLS + revoke.
- `002_cola.sql` — estado `procesando` e índice `(proceso_id, estado)`.
- `003_indices.sql` — índice `procesos (usuario, creado desc)` para métricas y revisión.
- `004_servidor.sql` — `pg_cron` + `pg_net`: cada minuto `disparar_cola()` llama a `/api/cola/procesar` (solo si hay trabajo) con la URL y el secreto de la tabla `config_cola` (los guarda `scripts/configurar-cola.ts`); y `metricas_usuario()` calcula las métricas en Postgres (si falta, `lib/metricas.ts` usa el cálculo en memoria).

Al cambiar el esquema: crea `00N_*.sql` y pide al usuario que lo ejecute (no hay conexión directa a la base).

---

## 5. Decisiones y simplificaciones

- **Cola en el servidor**: el cron de Supabase (gratis; el de Vercel Hobby es diario) llama a `/api/cola/procesar` (secreto `COLA_SECRETO`), que procesa ~40 s y cierra los procesos sin pendientes. El navegador sigue acelerando con `/lote` y al final pide el estado de cada factura (`GET /api/procesos/[id]/facturas`).
- **Imágenes guardadas en WebP ≤ 2000 px** (`lib/imagen.ts`); el SHA-256 es del original. Mismo resultado de OCR en las 10 muestras.
- **Máx. 100 imágenes por lote.**

- **Sin BulkWriter ni `/iniciar`**: cada subida ya deja su factura `pendiente`.
- **Reclamo por UPDATE condicional** (`estado` + `actualizado` deben coincidir) en vez de transacción; arriendo de 5 min para reclamar una `procesando` huérfana.
- **Número repetido** en otra imagen → la factura va a revisión con `numero = null` (no falla).
- **Excel no se guarda en Storage**: siempre refleja correcciones; no hay botón de "regenerar".
- **Métricas sin contadores**: se agregan al vuelo. "Leídas OK" = automáticas (`ok && !manual`); las corregidas van aparte.
- **Proveedores se agrupan por NIT** (el OCR escribe el mismo nombre en mayúsculas o minúsculas).
- **Restaurantes**: si hay impoconsumo y no hay IVA, no se exige el IVA del 19 %.
- **`corregirFactura` sin transacción**: guarda cliente y luego factura; si falla la segunda, como mucho queda un cliente huérfano (lo limpia `/api/datos/borrar`).
- **Motor en la página `/`, no en el layout**: si se navega durante el proceso se detiene; lo pendiente lo retoma cualquier llamada posterior a `/lote`.

## 6. Problemas conocidos y trampas

- **Vercel no rastrea el worker de Tesseract** (se carga por ruta): `next.config.ts` incluye a mano el worker, el WASM, el idioma y **las dependencias del worker** (`bmp-js`, `zlibjs`, `node-fetch`, `whatwg-url`, `tr46`…). Si actualizas `tesseract.js`, revisa sus `require` y el `*.nft.json` de `/lote`.
- **`factura_0006`** está inclinada y borrosa a propósito: siempre va a revisión (es lo esperado).
- **`next dev` huérfano**: si un servidor dev queda vivo después de detener su tarea, cada `console.log` lanza `EPIPE` y responde 500. Mátalo (`taskkill /PID <pid> /F`) y levanta otro.
- `npx tsx -e "..."` con `async` no imprime nada en este entorno: usa un archivo `.ts`.

---

## 7. Pruebas

Los scripts HTTP/E2E usan el usuario temporal **`pruebas@ejemplo.test`** (contraseña aleatoria, se crea y se borra en cada ejecución) y limpian todo lo que crean. Requieren que ese correo esté en `USUARIOS_PERMITIDOS` y que las 10 muestras **no** estén ya en la base.

- **Local**: está en el `.env` local.
- **Producción**: NO está. Para probar contra Vercel, añádelo temporalmente a `USUARIOS_PERMITIDOS` (production), redespliega, corre las pruebas con `BASE_URL=https://automatizacion-sand.vercel.app`, quítalo y redespliega.

```bash
npm run dev                                 # http://localhost:3000
npx tsc --noEmit && npx eslint . && npm test   # 23 tests unitarios (incl. OCR real de las 10 muestras)
npm run build

npx tsx scripts/probar-conexion.ts          # Database / Auth / Storage OK
npx tsx scripts/verificar-reglas.ts         # anon no lee ni escribe nada
npx tsx scripts/probar-auth.ts              # 401 / 403 / redirección a /login
npx tsx scripts/probar-pipeline.ts          # subida, rechazos, OCR, Excel = Supabase, duplicados (19 checks)
npx tsx scripts/probar-correccion.ts        # corrección manual por API (15 checks)
npx tsx scripts/probar-ui.ts                # E2E Playwright: carga, Excel, métricas, borrar (12 checks)
npx tsx scripts/configurar-cola.ts [url]    # guarda URL y secreto del cron en Supabase (tras la migración 004)
npx tsx scripts/probar-revision-ui.ts       # E2E Playwright: revisión y corrección (9 checks)

npx tsx scripts/ocr-muestras.ts [archivo]   # OCR de muestras/ → guarda texto en fixtures/ocr
npx tsx scripts/extraer-fixtures.ts         # re-extrae desde el texto guardado (sin OCR) para afinar el extractor

npx vercel deploy --prod                    # desplegar
npx vercel logs --query 'level:error'       # errores de los últimos 30 min
```

Capturas y Excel de las pruebas quedan en `salida/` (ignorado por git).

## 8. Resultados de referencia (10 muestras en `muestras/`)

- **9 ok + 1 a revisión** (`FE-000601`, imagen inclinada). La 0003 necesita el intento preprocesado (el original lee mal el NIT).
- **Total facturado: $103.705.157** — igual en Supabase, Excel (`SUM`), UI y métricas.
- **Tiempos**: OCR ~1,2–1,5 s por intento; 10 facturas en ~20 s local y ~22 s en Vercel (incluye arranque en frío).
- **Consumo** por lote: ~1 MB en Storage; el Excel no ocupa espacio. Muy por debajo de los planes gratuitos.

## 9. Estado

2026-11-14: rediseño (Carbon, tema claro/oscuro, easter egg en el logo), publicado y probado en producción (60/60). Después: cola en el servidor, lotes de 100, WebP y métricas en SQL (pendiente: migración 004 + `configurar-cola.ts` + despliegue).


Fases 0–9 y D completadas y verificadas en producción (2026-11-07). Pendiente opcional: conectar GitHub para despliegue automático, mover el motor al layout y enderezar fotos inclinadas automáticamente.
