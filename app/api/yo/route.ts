import { exigirUsuario } from "@/lib/auth";

export async function GET(request: Request): Promise<Response> {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;
  return Response.json({ email: usuario.email });
}
