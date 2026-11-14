export const CLAVE_TEMA = "tema";

/**
 * Se ejecuta en <head> antes de pintar: aplica el tema guardado o, la primera vez, el del sistema.
 * Así la página no se ve oscura un instante antes de pasar a clara.
 */
export const SCRIPT_TEMA = `try{var t=localStorage.getItem("${CLAVE_TEMA}");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.theme=t}catch(e){}`;
