import "dotenv/config";

import { audit, closeDatabase, getCampaignConfig, query } from "@/lib/db";
import type { Lead } from "@/lib/types";

/**
 * Reprocessa os leads do nicho "medico" já descobertos com a regra de localização
 * mais rígida: sem menção explícita a uma das 6 cidades do ICP na bio ou nos posts
 * do próprio perfil, location_confirmed = 0 pontos e is_icp = false, mesmo que o
 * score já registrado (calculado antes da correção) parecesse alto.
 *
 * Não chama o Gemini de novo — os outros critérios (profissão, consultório próprio,
 * perfil ativo, seguidores, bloqueio automático) já estão em score_breakdown e não
 * dependem da localização, então só recalculamos o campo que mudou de regra.
 */
const medicoLocationTerms = /\b(florianopolis|floripa|sao jose(?!\s+(?:dos|do|da)\b)|palhoca|biguacu|joinville|blumenau)\b/i;

const normalize = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

interface Row extends Pick<Lead, "id" | "ig_username" | "full_name" | "bio" | "recent_posts" | "status" | "is_icp" | "score"> {
  score_breakdown: {
    subtotal: number;
    automatic_block: string | null;
    followers_in_range: number;
    location_confirmed: number;
    practice_ownership: number;
    professional_active: number;
    profession_confirmed: number;
  };
}

async function main() {
  const campaign = await getCampaignConfig("medico");
  const result = await query<Row>(
    `SELECT id, ig_username, full_name, bio, recent_posts, status, is_icp, score, score_breakdown
     FROM leads WHERE niche = 'medico' AND score_breakdown IS NOT NULL ORDER BY score DESC`,
  );

  const rows: Array<{
    username: string; oldScore: number; newScore: number;
    oldStatus: string; newStatus: string; locationText: string;
  }> = [];

  for (const lead of result.rows) {
    const identityAndPosts = normalize(`${lead.full_name ?? ""} ${lead.bio ?? ""} ${lead.recent_posts.join(" ")}`);
    const locationConfirmed = medicoLocationTerms.test(identityAndPosts);
    const breakdown = lead.score_breakdown;

    const newLocationPoints = locationConfirmed ? 25 : 0;
    const newSubtotal = breakdown.profession_confirmed + newLocationPoints
      + breakdown.practice_ownership + breakdown.professional_active + breakdown.followers_in_range;
    const newScore = breakdown.automatic_block ? Math.min(30, newSubtotal) : newSubtotal;
    const professionConfirmed = breakdown.profession_confirmed > 0;
    const newIsIcp = professionConfirmed && locationConfirmed && !breakdown.automatic_block && newScore >= campaign.min_score_to_dm;
    const newStatus = newIsIcp && newScore >= campaign.min_score_to_dm ? "qualified" : "disqualified";

    const newBreakdown = { ...breakdown, location_confirmed: newLocationPoints, subtotal: newSubtotal };
    const reasonSuffix = locationConfirmed
      ? "Localização confirmada por menção explícita a uma das 6 cidades do ICP."
      : "Requalificado: sem menção explícita a Florianópolis/São José/Palhoça/Biguaçu/Joinville/Blumenau na bio ou nos posts — 0 pontos de localização, is_icp forçado a false.";

    await query(
      `UPDATE leads SET score = $2, score_breakdown = $3::jsonb, is_icp = $4, status = $5, score_reason = score_reason || ' | ' || $6, updated_at = NOW() WHERE id = $1`,
      [lead.id, newScore, JSON.stringify(newBreakdown), newIsIcp, newStatus, reasonSuffix],
    );

    if (newStatus !== lead.status) {
      await query(
        `UPDATE jobs SET status = 'done', last_error = 'cancelled: requalificado com critério de localização mais rígido', updated_at = NOW()
         WHERE kind IN ('outreach', 'followup') AND status = 'pending' AND payload->>'leadId' = $1`,
        [lead.id],
      );
    }

    rows.push({
      username: lead.ig_username,
      oldScore: lead.score,
      newScore,
      oldStatus: lead.status,
      newStatus,
      locationText: locationConfirmed ? "confirmada" : "não confirmada",
    });
  }

  await audit("leads.requalified_medico_location", {
    total: rows.length,
    passed: rows.filter((r) => r.newStatus === "qualified").length,
    failed: rows.filter((r) => r.newStatus === "disqualified").length,
  });

  console.info("\n@Instagram".padEnd(24), "Localização".padEnd(16), "Score (antes→depois)".padEnd(22), "Status (antes→depois)");
  console.info("-".repeat(90));
  for (const row of rows) {
    const changed = row.oldStatus !== row.newStatus ? "  ⚠ mudou" : "";
    console.info(
      `@${row.username}`.padEnd(24),
      row.locationText.padEnd(16),
      `${row.oldScore} → ${row.newScore}`.padEnd(22),
      `${row.oldStatus} → ${row.newStatus}${changed}`,
    );
  }
  const passed = rows.filter((r) => r.newStatus === "qualified");
  const failed = rows.filter((r) => r.newStatus === "disqualified");
  console.info(`\nPassam agora: ${passed.length}/${rows.length} — ${passed.map((r) => `@${r.username}`).join(", ") || "nenhum"}`);
  console.info(`Caem agora: ${failed.length}/${rows.length} — ${failed.map((r) => `@${r.username}`).join(", ") || "nenhum"}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
