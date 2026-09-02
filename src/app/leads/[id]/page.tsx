import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { query } from "@/lib/db";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [leadResult, conversations] = await Promise.all([
    query<Lead>("SELECT * FROM leads WHERE id = $1", [id]),
    query<{ id: string; direction: string; body: string; sent_at: Date }>("SELECT * FROM conversations WHERE lead_id = $1 ORDER BY sent_at", [id]),
  ]);
  const lead = leadResult.rows[0];
  if (!lead) notFound();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold text-blue-700">@{lead.ig_username}</p><h1 className="mt-1 text-3xl font-bold">{lead.full_name || "Nome não informado"}</h1></div><Badge variant={lead.status}>{lead.status}</Badge></div>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
        <Card><CardHeader><h2 className="font-semibold">Perfil e qualificação</h2></CardHeader><CardContent className="space-y-4 text-sm"><div><span className="text-slate-500">Bio</span><p className="mt-1">{lead.bio || "—"}</p></div><div className="grid grid-cols-3 gap-3"><div><span className="text-slate-500">Seguidores</span><strong className="block">{lead.followers_count?.toLocaleString("pt-BR") ?? "—"}</strong></div><div><span className="text-slate-500">Posts</span><strong className="block">{lead.posts_count ?? "—"}</strong></div><div><span className="text-slate-500">Score</span><strong className="block text-2xl">{lead.score}</strong></div></div><div><span className="text-slate-500">Justificativa</span><p className="mt-1">{lead.score_reason || "Ainda não qualificado."}</p></div><a className="inline-block font-semibold text-blue-700 hover:underline" href={`https://instagram.com/${lead.ig_username}`} target="_blank" rel="noreferrer">Abrir no Instagram ↗</a></CardContent></Card>
        <Card><CardHeader><h2 className="font-semibold">Conversa</h2></CardHeader><CardContent className="space-y-4">{conversations.rows.map((message) => <div key={message.id} className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${message.direction === "outbound" ? "ml-auto bg-blue-700 text-white" : "bg-slate-100 text-slate-900"}`}><p>{message.body}</p><p className={`mt-2 text-xs ${message.direction === "outbound" ? "text-blue-200" : "text-slate-400"}`}>{message.sent_at.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p></div>)}{conversations.rows.length === 0 && <p className="text-sm text-slate-500">Nenhuma mensagem registrada.</p>}</CardContent></Card>
      </div>
    </div>
  );
}
