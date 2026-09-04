"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { Lead } from "@/lib/types";

function scoreBadgeClass(score: number) {
  if (score >= 90) return "bg-green-100 text-green-800";
  if (score >= 70) return "bg-blue-100 text-blue-800";
  if (score >= 50) return "bg-yellow-100 text-yellow-800";
  return "bg-slate-100 text-slate-500";
}

function stopRowNavigation(event: MouseEvent<HTMLAnchorElement>) {
  event.stopPropagation();
}

function ContactLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      target="_blank"
      rel="noreferrer"
      onClick={stopRowNavigation}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:border-blue-300 hover:bg-blue-50"
    >
      {children}
    </a>
  );
}

function InstagramIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.8]"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.4" cy="6.7" r=".9" className="fill-current stroke-none" /></svg>;
}

function WhatsAppIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.8]"><path d="M20 11.5a8 8 0 0 1-11.7 7.1L4 20l1.4-4.1A8 8 0 1 1 20 11.5Z" /><path d="M9.3 8.2c.2-.5.5-.5.8-.5h.4c.2 0 .4.1.5.4l.8 1.8c.1.2.1.4 0 .6l-.5.7c.5 1 1.3 1.8 2.3 2.3l.7-.5c.2-.1.4-.1.6 0l1.8.8c.3.1.4.3.4.5v.4c0 .3 0 .6-.5.8-.5.2-1.4.3-2.6-.3-1-.5-2-1.3-2.8-2.1-.8-.8-1.6-1.8-2.1-2.8-.6-1.2-.5-2.1-.3-2.6Z" /></svg>;
}

export function LeadRow({ lead }: { lead: Lead }) {
  const router = useRouter();
  const openLead = () => router.push(`/leads/${lead.id}`);
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openLead();
    }
  };

  return (
    <tr
      tabIndex={0}
      role="link"
      aria-label={`Abrir lead @${lead.ig_username}`}
      onClick={openLead}
      onKeyDown={onKeyDown}
      className="cursor-pointer border-b border-slate-200 even:bg-slate-50/60 outline-none transition hover:bg-blue-50/60 focus-visible:bg-blue-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
    >
      <td className="px-5 py-5">
        <span className="block font-semibold text-slate-900">{lead.full_name || `@${lead.ig_username}`}</span>
        <span className="block text-xs text-slate-500">@{lead.ig_username}</span>
      </td>
      <td className="px-5 py-5">
        <div className="flex gap-2">
          <ContactLink href={lead.ig_profile_url || `https://instagram.com/${lead.ig_username}`} label={`Abrir @${lead.ig_username} no Instagram`}><InstagramIcon /></ContactLink>
          {lead.whatsapp && <ContactLink href={`https://wa.me/${lead.whatsapp}`} label={`Abrir WhatsApp de @${lead.ig_username}`}><WhatsAppIcon /></ContactLink>}
        </div>
      </td>
      <td className="px-5 py-5">
        {lead.email ? <a href={`mailto:${lead.email}`} onClick={stopRowNavigation} className="text-blue-700 hover:underline">{lead.email}</a> : <span className="text-slate-400">—</span>}
      </td>
      <td className="px-5 py-5">{lead.niche}</td>
      <td className="px-5 py-5"><span className={`inline-flex min-w-[2.5rem] justify-center rounded-full px-2.5 py-1 text-sm font-bold ${scoreBadgeClass(lead.score)}`}>{lead.score}</span></td>
      <td className="px-5 py-5"><Badge variant={lead.status}>{lead.status}</Badge></td>
      <td className="px-5 py-5 text-slate-500">{lead.discovered_at.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
    </tr>
  );
}
