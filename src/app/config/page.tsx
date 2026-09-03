import { ConfigForm } from "@/components/config-form";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getCampaignConfigs } from "@/lib/db";

export const dynamic = "force-dynamic";

const NICHE_LABELS: Record<string, string> = {
  psicologo: "Psicólogos",
  medico: "Médicos — Florianópolis e região",
};

export default async function ConfigPage() {
  const campaigns = await getCampaignConfigs();
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-blue-700">CAMPANHAS</p>
        <h1 className="mt-1 text-3xl font-bold">Configuração</h1>
        <p className="mt-2 text-slate-500">
          {campaigns.length} nicho(s) cadastrado(s) — ative ou desative cada um independentemente.
        </p>
      </div>
      {campaigns.map((campaign) => (
        <Card key={campaign.id}>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">
                {NICHE_LABELS[campaign.niche] ?? campaign.niche} · {campaign.product_name}
              </h2>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  campaign.active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                }`}
              >
                {campaign.active ? "ativa" : "inativa"}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <ConfigForm campaign={campaign} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
