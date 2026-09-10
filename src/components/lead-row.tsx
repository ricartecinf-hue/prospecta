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
  return (
    <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center rounded-[5px] bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 text-white">
      <svg viewBox="0 0 24 24" className="h-[15px] w-[15px] fill-none stroke-current stroke-2">
        <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5.2" />
        <circle cx="12" cy="12" r="4.1" />
        <circle cx="17.4" cy="6.7" r="1" className="fill-current stroke-none" />
      </svg>
    </span>
  );
}

function WhatsAppIcon() {
  return (
    <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#25D366] text-white">
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
        <path d="M12.05 3.2a8.65 8.65 0 0 0-7.48 13l-1.13 4.12 4.22-1.1a8.66 8.66 0 1 0 4.39-16.02Zm0 15.75a7.1 7.1 0 0 1-3.62-.99l-.26-.15-2.5.66.67-2.43-.17-.27a7.1 7.1 0 1 1 5.88 3.18Zm3.9-5.31c-.22-.11-1.27-.63-1.47-.7-.2-.08-.34-.12-.48.1-.14.22-.55.7-.68.84-.12.15-.25.17-.46.06-.22-.1-.91-.33-1.73-1.07a6.46 6.46 0 0 1-1.2-1.49c-.13-.21-.01-.33.1-.44.1-.1.21-.25.32-.38.11-.12.14-.21.22-.36.07-.14.03-.27-.02-.38-.05-.1-.48-1.16-.66-1.6-.17-.41-.35-.36-.48-.36h-.41c-.15 0-.38.06-.58.27-.2.22-.76.75-.76 1.82 0 1.08.78 2.12.9 2.27.1.14 1.54 2.35 3.73 3.3.52.22.93.36 1.25.46.52.16 1 .14 1.37.08.42-.06 1.28-.53 1.46-1.03.18-.5.18-.92.13-1.02-.06-.09-.2-.14-.42-.25Z" />
      </svg>
    </span>
  );
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
      <td className="px-5 py-5">{lead.niche}</td>
      <td className="px-5 py-5"><span className={`inline-flex min-w-[2.5rem] justify-center rounded-full px-2.5 py-1 text-sm font-bold ${scoreBadgeClass(lead.score)}`}>{lead.score}</span></td>
      <td className="px-5 py-5"><Badge variant={lead.status}>{lead.status}</Badge></td>
      <td className="px-5 py-5 text-slate-500">{lead.discovered_at.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
    </tr>
  );
}
