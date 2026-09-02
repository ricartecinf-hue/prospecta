import { ConfigForm } from "@/components/config-form";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getCampaignConfig } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ConfigPage() {
  const campaign = await getCampaignConfig();
  return <div className="space-y-6"><div><p className="text-sm font-semibold text-blue-700">CAMPANHA</p><h1 className="mt-1 text-3xl font-bold">Configuração</h1><p className="mt-2 text-slate-500">{campaign.product_name}</p></div><Card><CardHeader><h2 className="font-semibold">ICP, mensagens e limites</h2></CardHeader><CardContent><ConfigForm campaign={campaign} /></CardContent></Card></div>;
}
