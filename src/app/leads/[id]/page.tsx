import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { query } from "@/lib/db";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span><div className="mt-1 break-words text-sm">{children ?? "—"}</div></div>;
}

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
        <Card><CardHeader><h2 className="font-semibold">Perfil e qualificação</h2></CardHeader><CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ID">{lead.id}</Field>
            <Field label="Instagram"><a className="font-semibold text-blue-700 hover:underline" href={lead.ig_profile_url || `https://instagram.com/${lead.ig_username}`} target="_blank" rel="noreferrer">@{lead.ig_username} ↗</a></Field>
            <Field label="WhatsApp">{lead.whatsapp ? <a className="font-semibold text-emerald-700 hover:underline" href={`https://wa.me/${lead.whatsapp}`} target="_blank" rel="noreferrer">+{lead.whatsapp} ↗</a> : "—"}</Field>
            <Field label="Email">{lead.email ? <a className="font-semibold text-blue-700 hover:underline" href={`mailto:${lead.email}`}>{lead.email}</a> : "—"}</Field>
            <Field label="Nome completo">{lead.full_name || "—"}</Field>
            <Field label="ID Instagram">{lead.ig_user_id || "—"}</Field>
            <Field label="Nicho">{lead.niche}</Field>
            {/* "Origem" só aparece aqui — foi removida da tabela principal de /leads */}
            <Field label="Origem">{lead.source || "—"}</Field>
            <Field label="Seguidores">{lead.followers_count?.toLocaleString("pt-BR") ?? "—"}</Field>
            <Field label="Seguindo">{lead.following_count?.toLocaleString("pt-BR") ?? "—"}</Field>
            <Field label="Posts">{lead.posts_count?.toLocaleString("pt-BR") ?? "—"}</Field>
            <Field label="Score"><strong className="text-2xl">{lead.score}</strong></Field>
            <Field label="ICP">{lead.is_icp === null ? "—" : lead.is_icp ? "Sim" : "Não"}</Field>
            <Field label="Não contatar">{lead.do_not_contact ? "Sim" : "Não"}</Field>
            <Field label="Descoberto em">{lead.discovered_at.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</Field>
            <Field label="Qualificado em">{lead.qualified_at?.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) ?? "—"}</Field>
            <Field label="Atualizado em">{lead.updated_at.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</Field>
            <Field label="Foto do perfil">{lead.profile_pic_url ? <a className="text-blue-700 hover:underline" href={lead.profile_pic_url} target="_blank" rel="noreferrer">Abrir imagem ↗</a> : "—"}</Field>
          </div>
          <Field label="Bio">{lead.bio || "—"}</Field>
          <Field label="Justificativa">{lead.score_reason || "Ainda não qualificado."}</Field>
          <Field label="Detalhamento da nota"><pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{lead.score_breakdown ? JSON.stringify(lead.score_breakdown, null, 2) : "—"}</pre></Field>
          <Field label="Posts recentes">{lead.recent_posts?.length ? <ul className="list-disc space-y-1 pl-5">{lead.recent_posts.map((post, index) => <li key={index}>{post}</li>)}</ul> : "—"}</Field>
        </CardContent></Card>
        <Card><CardHeader><h2 className="font-semibold">Conversa</h2></CardHeader><CardContent className="space-y-4">{conversations.rows.map((message) => <div key={message.id} className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${message.direction === "outbound" ? "ml-auto bg-blue-700 text-white" : "bg-slate-100 text-slate-900"}`}><p>{message.body}</p><p className={`mt-2 text-xs ${message.direction === "outbound" ? "text-blue-200" : "text-slate-400"}`}>{message.sent_at.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p></div>)}{conversations.rows.length === 0 && <p className="text-sm text-slate-500">Nenhuma mensagem registrada.</p>}</CardContent></Card>
      </div>
    </div>
  );
}
