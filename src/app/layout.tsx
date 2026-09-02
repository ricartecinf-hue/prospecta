import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prospecta",
  description: "Prospecta — prospecção autônoma e qualificação de leads no Instagram.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        <header className="border-b border-slate-200 bg-slate-950 text-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
            <Link href="/dashboard" className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-500 font-black">P</span>
              <span><strong className="block leading-none">Prospecta</strong><small className="text-slate-400">Prospecção inteligente</small></span>
            </Link>
            <nav className="flex gap-1 text-sm text-slate-300">
              <Link className="rounded-lg px-3 py-2 hover:bg-slate-800 hover:text-white" href="/dashboard">Visão geral</Link>
              <Link className="rounded-lg px-3 py-2 hover:bg-slate-800 hover:text-white" href="/leads">Leads</Link>
              <Link className="rounded-lg px-3 py-2 hover:bg-slate-800 hover:text-white" href="/config">Configuração</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-5 py-8">{children}</main>
      </body>
    </html>
  );
}
