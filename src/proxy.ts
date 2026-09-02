import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const expectedUser = process.env.DASHBOARD_USER;
  const expectedPassword = process.env.DASHBOARD_PASSWORD;
  if (!expectedUser || !expectedPassword) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("DASHBOARD_USER e DASHBOARD_PASSWORD são obrigatórios em produção.", { status: 503 });
    }
    return NextResponse.next();
  }
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Basic ")) {
    try {
      const decoded = atob(authorization.slice(6));
      const separator = decoded.indexOf(":");
      const user = decoded.slice(0, separator);
      const password = decoded.slice(separator + 1);
      if (separator > 0 && user === expectedUser && password === expectedPassword) return NextResponse.next();
    } catch {
      // Cabeçalho Basic inválido: retorna o desafio abaixo.
    }
  }
  return new NextResponse("Autenticação necessária.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Prospecta", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
