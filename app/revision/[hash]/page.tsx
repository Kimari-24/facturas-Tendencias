import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { usuarioActual } from "@/lib/auth";
import { ErrorHttp } from "@/lib/procesos";
import { listarRevision, obtenerFactura } from "@/lib/revision";
import { EsqueletoEditor } from "../../_componentes/Esqueleto";
import { Nav } from "../../_componentes/Nav";
import { Editor } from "./Editor";

export default function PaginaFactura({ params }: PageProps<"/revision/[hash]">) {
  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        <Suspense fallback={<EsqueletoEditor />}>
          <Contenido params={params} />
        </Suspense>
      </main>
    </>
  );
}

async function Contenido({ params }: { params: Promise<{ hash: string }> }) {
  const usuario = await usuarioActual();
  if (!usuario) redirect("/login");
  const { hash } = await params;
  // Factura y cola de pendientes en paralelo: la cola da la posición ("2 de 5") y a cuál saltar al guardar
  const [factura, { pendientes }] = await Promise.all([
    obtenerFactura(hash, usuario.email).catch((e: unknown) => {
      if (e instanceof ErrorHttp && e.status === 404) notFound();
      throw e;
    }),
    listarRevision(usuario.email),
  ]);
  const i = pendientes.findIndex((p) => p.hash === hash);
  const siguiente = pendientes.find((p, j) => p.hash !== hash && (i < 0 || j > i)) ?? pendientes.find((p) => p.hash !== hash);
  return <Editor factura={factura} posicion={i < 0 ? null : { actual: i + 1, total: pendientes.length }} siguiente={siguiente?.hash ?? null} />;
}
