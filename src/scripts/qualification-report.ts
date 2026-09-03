import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { closeDatabase, query } from "@/lib/db";

interface ComparisonRow {
  ig_username: string;
  old_score: number | null;
  new_score: number;
  is_icp: boolean;
  score_reason: string;
}

async function main() {
  const result = await query<ComparisonRow>(
    `SELECT l.ig_username,
            NULLIF(j.payload->>'previousScore', '')::integer AS old_score,
            l.score AS new_score,
            COALESCE(l.is_icp, false) AS is_icp,
            COALESCE(l.score_reason, '') AS score_reason
       FROM leads l
       JOIN LATERAL (
         SELECT payload
           FROM jobs
          WHERE kind = 'qualify' AND payload->>'leadId' = l.id::text
          ORDER BY created_at DESC
          LIMIT 1
       ) j ON true
      WHERE l.score_breakdown IS NOT NULL
      ORDER BY l.score DESC, l.ig_username ASC`,
  );
  const qualified = result.rows.filter((row) => row.is_icp).length;
  const lines = [
    "# Requalificação estruturada — Prospecta",
    "",
    `- Total: ${result.rows.length}`,
    `- ICP: ${qualified}`,
    `- Não ICP: ${result.rows.length - qualified}`,
    "- Ordenação: score novo decrescente",
    "",
    "| @Instagram | Antigo | Novo | Δ | ICP | Motivo |",
    "|---|---:|---:|---:|:---:|---|",
    ...result.rows.map((row) => {
      const oldScore = row.old_score ?? 0;
      const delta = row.new_score - oldScore;
      const reason = row.score_reason.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
      return `| @${row.ig_username} | ${oldScore} | ${row.new_score} | ${delta >= 0 ? "+" : ""}${delta} | ${row.is_icp ? "sim" : "não"} | ${reason} |`;
    }),
    "",
  ];
  const output = path.resolve(".logs/qualification-comparison-2026-09-02.md");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, lines.join("\n"), "utf8");
  console.info(output);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(closeDatabase);
