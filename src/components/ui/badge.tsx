import type { ReactNode } from "react";

const variants: Record<string, string> = {
  discovered: "bg-slate-100 text-slate-700",
  qualified: "bg-blue-100 text-blue-800",
  disqualified: "bg-zinc-100 text-zinc-500",
  dm_sent: "bg-violet-100 text-violet-800",
  replied: "bg-amber-100 text-amber-800",
  handed_off: "bg-emerald-100 text-emerald-800",
  converted: "bg-green-100 text-green-800",
  do_not_contact: "bg-red-100 text-red-800",
  pending: "bg-amber-100 text-amber-800",
  running: "bg-blue-100 text-blue-800",
  dead: "bg-red-100 text-red-800",
};

export function Badge({ children, variant = "default" }: { children: ReactNode; variant?: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${variants[variant] ?? "bg-slate-100 text-slate-700"}`}>{children}</span>;
}
