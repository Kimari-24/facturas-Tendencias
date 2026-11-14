"use client";

import { useEffect, useRef } from "react";

/**
 * Ilustración animada del login (Lottie). Se usa el build "light" de lottie-web (solo SVG, sin WASM ni CDN)
 * y el JSON va dentro del bundle de esta página: no hay peticiones extra ni dependencia de lottie.host.
 * Con "reducir movimiento" activado se muestra el último cuadro, quieto.
 */
export function Animacion() {
  const contenedor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Panel oculto (celular): no se descarga ni se anima nada
    if (!contenedor.current || contenedor.current.offsetParent === null) return;
    let cancelado = false;
    let destruir = (): void => {};
    void Promise.all([import("lottie-web/build/player/lottie_light"), import("./animacion.json")]).then(([{ default: lottie }, datos]) => {
      if (cancelado || !contenedor.current) return;
      const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const anim = lottie.loadAnimation({
        container: contenedor.current,
        renderer: "svg",
        loop: !quieto,
        autoplay: !quieto,
        animationData: structuredClone(datos.default),
      });
      if (quieto) anim.goToAndStop(anim.totalFrames - 1, true);
      destruir = () => anim.destroy();
    });
    return () => {
      cancelado = true;
      destruir();
    };
  }, []);

  return <div ref={contenedor} aria-hidden="true" className="aspect-square w-full max-w-md" />;
}
