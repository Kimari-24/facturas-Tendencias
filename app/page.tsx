import { Motor } from "./_componentes/Motor";
import { Nav } from "./_componentes/Nav";

export default function Inicio() {
  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-5xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-semibold">Cargar facturas</h1>
        <Motor />
      </main>
    </>
  );
}
