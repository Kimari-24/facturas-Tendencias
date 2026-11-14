"use client";

import { useEffect, useRef, useState, type PointerEvent as EventoPuntero } from "react";
import { createPortal } from "react-dom";

/**
 * Easter egg: el personaje pixelado de Claude Code (dibujo propio) que cae por la pantalla,
 * rebota en los bordes, se arrastra y se lanza con el puntero, y salta cuando lo golpeas (clic sin arrastrar).
 * Cuando se queda quieto se pone a "trabajar": cambia de pose (gafas, computador, dormido), parpadea
 * y muestra palabras al azar con el indicador giratorio de Claude Code (✻ Pensando…).
 * La física corre en requestAnimationFrame escribiendo el transform directo en el DOM: no re-renderiza React.
 * Con "reducir movimiento" no hay gravedad ni rebotes: solo se puede arrastrar.
 */

const TAM = 72; // px
const GRAVEDAD = 2200; // px/s²
const REBOTE = 0.62;
const ROCE = 0.985;

// Personaje pixelado al estilo de la mascota de Claude Code (dibujo propio, no el archivo oficial).
// Cuerpo sin ojos: los ojos, las gafas y el computador se dibujan encima según la pose.
const CUERPO = [
  "..##########..",
  "..##########..",
  "..##########..",
  "..##########..",
  "##############",
  "##############",
  "..##########..",
  "..##########..",
  "..#.#....#.#..",
  "..#.#....#.#..",
];
const COLUMNAS = CUERPO[0].length;
const FILAS = CUERPO.length;
const ALTO = Math.round((TAM * FILAS) / COLUMNAS);

const NARANJA = "#d97757";
const NEGRO = "#1f1f1f";

export type Pose = "normal" | "parpadeo" | "gafas" | "computador" | "dormido";
type Pixel = [x: number, y: number, color: string];

const rango = (desde: number, hasta: number, y: number, color: string): Pixel[] =>
  Array.from({ length: hasta - desde + 1 }, (_, k) => [desde + k, y, color]);

const ENCIMA: Record<Pose, Pixel[]> = {
  normal: [[4, 2, NEGRO], [4, 3, NEGRO], [9, 2, NEGRO], [9, 3, NEGRO]],
  // ojos cerrados: solo la línea de abajo
  parpadeo: [[4, 3, NEGRO], [9, 3, NEGRO]],
  dormido: [[3, 3, NEGRO], [4, 3, NEGRO], [9, 3, NEGRO], [10, 3, NEGRO]],
  // gafas de sol: montura de lado a lado y dos lentes con un brillo
  gafas: [
    ...rango(2, 11, 2, "#111111"),
    ...rango(3, 5, 3, "#111111"),
    ...rango(8, 10, 3, "#111111"),
    [3, 2, "#5a5a5a"],
    [8, 2, "#5a5a5a"],
  ],
  // mira hacia abajo y tiene un portátil delante (se ve la tapa por detrás)
  computador: [
    [4, 3, NEGRO],
    [9, 3, NEGRO],
    ...[5, 6, 7].flatMap((y) => rango(3, 10, y, "#c6c6c6")),
    [6, 6, "#f4f4f4"],
    [7, 6, "#f4f4f4"],
    ...rango(1, 12, 8, "#8d8d8d"),
  ],
};

// Palabras de "estoy trabajando", al estilo de Claude Code. Algunas dependen de la pose.
const PALABRAS: Record<"general" | "gafas" | "computador" | "dormido", string[]> = {
  general: ["Pensando", "Maquinando", "Cavilando", "Rumiando", "Tramando algo", "Divagando", "Clauding", "Cuadrando el IVA", "Revisando NITs", "Sumando ítems", "Garabateando", "Calculando"],
  gafas: ["Siendo cool", "Relajándome", "Facturando con estilo", "Todo bajo control"],
  computador: ["Compilando", "Escribiendo código", "Haciendo commit", "Leyendo facturas", "Depurando", "Afinando el OCR"],
  dormido: ["Zzz", "Soñando con facturas", "Descansando"],
};
const GIRA = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
const azar = <T,>(lista: T[]): T => lista[Math.floor(Math.random() * lista.length)];

export default function Huevo({ onCerrar }: { onCerrar: () => void }) {
  const icono = useRef<HTMLButtonElement>(null);
  const globo = useRef<HTMLSpanElement>(null);
  const pensamiento = useRef<HTMLSpanElement>(null);
  const [pose, setPose] = useState<Pose>("normal");
  const estado = useRef({ x: 0, y: 0, vx: 0, vy: 0, giro: 0, vgiro: 0, arrastrando: false, quieto: false });
  const arrastre = useRef({ dx: 0, dy: 0, inicioX: 0, inicioY: 0, ultimoX: 0, ultimoY: 0, ultimoT: 0, movio: false });
  // Qué está haciendo cuando se queda quieto: pose, palabra y cuándo cambiar
  const actividad = useRef({ reposo: 0, pose: "normal" as Pose, palabra: "", cambio: 0, parpadeo: 0 });

  useEffect(() => {
    const s = estado.current;
    const act = actividad.current;
    s.quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    s.x = window.innerWidth / 2 - TAM / 2;
    s.y = s.quieto ? window.innerHeight / 2 - ALTO / 2 : -ALTO;
    s.vx = s.quieto ? 0 : (Math.random() - 0.5) * 500;
    s.vgiro = s.quieto ? 0 : 180;

    const ponerPose = (p: Pose): void => {
      if (act.pose !== p) {
        act.pose = p;
        setPose(p);
      }
    };
    const nuevaActividad = (t: number): void => {
      const p = azar(["normal", "normal", "gafas", "computador", "computador", "dormido"] as const);
      ponerPose(p);
      act.palabra = azar(p === "normal" ? PALABRAS.general : [...PALABRAS[p], ...PALABRAS.general.slice(0, 3)]);
      act.cambio = t + 3500 + Math.random() * 3000;
    };

    let t0 = performance.now();
    act.parpadeo = t0 + 2000;
    let cuadro = 0;
    const paso = (t: number): void => {
      const dt = Math.min(0.032, (t - t0) / 1000);
      t0 = t;
      const maxX = window.innerWidth - TAM;
      const maxY = window.innerHeight - ALTO;
      if (!s.arrastrando && !s.quieto) {
        s.vy += GRAVEDAD * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.giro += s.vgiro * dt;
        if (s.x < 0 || s.x > maxX) {
          s.x = Math.max(0, Math.min(maxX, s.x));
          s.vx *= -REBOTE;
          s.vgiro *= -0.8;
        }
        if (s.y > maxY) {
          s.y = maxY;
          s.vy = Math.abs(s.vy) < 60 ? 0 : -s.vy * REBOTE;
          s.vx *= 0.9;
          s.vgiro = s.vx * 0.8; // rueda por el suelo
        }
        if (s.y < 0 && s.vy < 0) {
          s.y = 0;
          s.vy *= -REBOTE;
        }
        s.vx *= ROCE;
      }

      // ¿Está quieto? (en el suelo y casi sin velocidad, o con movimiento reducido)
      const enReposo = !s.arrastrando && (s.quieto || (s.y >= maxY - 0.5 && s.vy === 0 && Math.abs(s.vx) < 25));
      act.reposo = enReposo ? act.reposo + dt : 0;
      if (enReposo) {
        // se endereza: vuelve a la vuelta completa más cercana
        const recto = Math.round(s.giro / 360) * 360;
        s.giro += (recto - s.giro) * Math.min(1, dt * 10);
        s.vgiro = 0;
      }
      const ocupado = act.reposo > 1.2;
      if (ocupado && t > act.cambio) nuevaActividad(t);
      if (!ocupado && act.cambio !== 0) {
        act.cambio = 0;
        act.palabra = "";
        ponerPose("normal");
      }
      // parpadea de vez en cuando si está con los ojos al aire
      if ((act.pose === "normal" || act.pose === "parpadeo") && t > act.parpadeo) {
        ponerPose(act.pose === "normal" ? "parpadeo" : "normal");
        act.parpadeo = t + (act.pose === "parpadeo" ? 130 : 2000 + Math.random() * 3000);
      }

      // respira (sube y baja 1 px) mientras trabaja; teclea más rápido con el computador
      const respira = ocupado && !s.quieto ? Math.sin(t / (act.pose === "computador" ? 90 : 400)) * 1.5 : 0;
      if (icono.current) icono.current.style.transform = `translate(${s.x}px, ${s.y + respira}px) rotate(${s.giro}deg)`;
      if (globo.current) globo.current.style.transform = `translate(${s.x + TAM * 0.7}px, ${s.y - 22}px)`;
      const pe = pensamiento.current;
      if (pe) {
        pe.style.opacity = act.palabra ? "1" : "0";
        if (act.palabra) {
          const giro = s.quieto ? "✻" : GIRA[Math.floor(t / 120) % GIRA.length];
          const puntos = s.quieto ? "…" : ".".repeat(1 + (Math.floor(t / 400) % 3));
          pe.textContent = `${giro} ${act.palabra}${puntos}`;
          const ancho = pe.offsetWidth;
          pe.style.transform = `translate(${Math.max(4, Math.min(window.innerWidth - ancho - 4, s.x + TAM / 2 - ancho / 2))}px, ${s.y - 30}px)`;
        }
      }
      cuadro = requestAnimationFrame(paso);
    };
    cuadro = requestAnimationFrame(paso);

    const tecla = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", tecla);
    return () => {
      cancelAnimationFrame(cuadro);
      window.removeEventListener("keydown", tecla);
    };
  }, [onCerrar]);

  function golpear(): void {
    const s = estado.current;
    actividad.current.reposo = 0; // lo despierta
    if (!s.quieto) {
      s.vy = -900 - Math.random() * 400;
      s.vx += (Math.random() - 0.5) * 700;
      s.vgiro += (Math.random() - 0.5) * 1400;
    }
    const g = globo.current;
    if (g) {
      g.textContent = azar(["¡Ay!", "¡Ey!", "¡Oye!", "Hola 👋", "¡Uf!", "¡Estaba trabajando!"]);
      g.classList.remove("huevo-globo--ver");
      void g.offsetWidth; // reinicia la animación
      g.classList.add("huevo-globo--ver");
    }
    icono.current?.animate([{ scale: "1.25 0.75" }, { scale: "0.9 1.1" }, { scale: "1 1" }], { duration: 260, easing: "ease-out" });
  }
  function bajar(e: EventoPuntero<HTMLButtonElement>): void {
    const s = estado.current;
    const a = arrastre.current;
    e.currentTarget.setPointerCapture(e.pointerId);
    s.arrastrando = true;
    a.dx = e.clientX - s.x;
    a.dy = e.clientY - s.y;
    a.inicioX = a.ultimoX = e.clientX;
    a.inicioY = a.ultimoY = e.clientY;
    a.ultimoT = performance.now();
    a.movio = false;
  }

  function mover(e: EventoPuntero<HTMLButtonElement>): void {
    const s = estado.current;
    const a = arrastre.current;
    if (!s.arrastrando) return;
    if (Math.hypot(e.clientX - a.inicioX, e.clientY - a.inicioY) > 5) a.movio = true;
    const ahora = performance.now();
    const dt = Math.max(1, ahora - a.ultimoT) / 1000;
    // velocidad del último tramo: al soltar, sale lanzado con ella
    s.vx = (e.clientX - a.ultimoX) / dt;
    s.vy = (e.clientY - a.ultimoY) / dt;
    a.ultimoX = e.clientX;
    a.ultimoY = e.clientY;
    a.ultimoT = ahora;
    s.x = Math.max(0, Math.min(window.innerWidth - TAM, e.clientX - a.dx));
    s.y = Math.max(0, Math.min(window.innerHeight - ALTO, e.clientY - a.dy));
  }

  function soltar(): void {
    const s = estado.current;
    if (!s.arrastrando) return;
    s.arrastrando = false;
    s.vx = Math.max(-2500, Math.min(2500, s.vx));
    s.vy = Math.max(-2500, Math.min(2500, s.vy));
    if (!arrastre.current.movio) golpear();
  }

  // Portal a <body>: fuera de la barra superior, para no heredar sus estilos
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <button
        ref={icono}
        type="button"
        aria-label="Claude Code: arrástralo o golpéalo"
        onPointerDown={bajar}
        onPointerMove={mover}
        onPointerUp={soltar}
        onPointerCancel={soltar}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && golpear()}
        className="huevo pointer-events-auto absolute top-0 left-0 touch-none"
        style={{ width: TAM, height: ALTO }}
      >
        <svg viewBox={`0 0 ${COLUMNAS} ${FILAS}`} className="h-full w-full" shapeRendering="crispEdges" aria-hidden="true">
          {CUERPO.flatMap((fila, y) =>
            [...fila].map((c, x) => (c === "#" ? <rect key={`c${x}-${y}`} x={x} y={y} width="1.02" height="1.02" fill={NARANJA} /> : null)),
          )}
          {/* clave con la pose: al cambiar de pose se redibuja la capa entera (hay píxeles repetidos a propósito) */}
          {ENCIMA[pose].map(([x, y, color], i) => (
            <rect key={`${pose}-${i}`} x={x} y={y} width="1.02" height="1.02" fill={color} />
          ))}
        </svg>
      </button>
      <span ref={globo} className="huevo-globo absolute top-0 left-0" aria-live="polite" />
      <span ref={pensamiento} data-pose={pose} className="huevo-pensamiento absolute top-0 left-0" aria-hidden="true" />
      <button type="button" onClick={onCerrar} className="btn btn--sm pointer-events-auto absolute top-16 right-4">
        Guardar a Claude (Esc)
      </button>
    </div>,
    document.body,
  );
}
