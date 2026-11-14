import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  // tesseract.js y sharp usan binarios/WASM nativos: no se deben empaquetar
  serverExternalPackages: ["tesseract.js", "sharp"],
  // El worker de Tesseract se carga por ruta (no por import): Next no rastrea ni a él ni a SUS
  // dependencias, así que se incluyen a mano (en Vercel faltaba bmp-js y el worker moría).
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./node_modules/tesseract.js/src/**/*",
      "./node_modules/tesseract.js-core/*.{js,wasm}",
      "./node_modules/@tesseract.js-data/spa/4.0.0/**/*",
      ...["bmp-js", "zlibjs", "wasm-feature-detect", "is-url", "idb-keyval", "regenerator-runtime", "node-fetch", "whatwg-url", "tr46", "webidl-conversions"].map(
        (p) => `./node_modules/${p}/**/*`,
      ),
    ],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
