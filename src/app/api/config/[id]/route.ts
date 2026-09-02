import { NextResponse } from "next/server";
import { z } from "zod";
import { audit, query } from "@/lib/db";

const schema = z.object({
  icp_description: z.string().min(10),
  icp_hashtags: z.array(z.string().min(2)).min(1),
  icp_competitors: z.array(z.string().min(2)),
  verified_claims: z.array(z.string().min(5)).min(1),
  dm_template_1: z.string().min(20),
  dm_template_followup: z.string().nullable().optional(),
  whatsapp_number: z.string().regex(/^\d{10,15}$/),
  max_dm_per_day: z.number().int().min(1).max(30),
  window_start_hour: z.number().int().min(9).max(19),
  window_end_hour: z.number().int().min(10).max(20),
  min_score_to_dm: z.number().int().min(0).max(100),
  followup_after_hours: z.number().int().min(1).max(720),
  active: z.boolean(),
}).refine((data) => data.window_start_hour < data.window_end_hour, { message: "A hora inicial deve ser menor que a final." });

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const data = schema.parse(await request.json());
    const result = await query(
      `UPDATE campaign_config SET icp_description=$2, icp_hashtags=$3, icp_competitors=$4,
       verified_claims=$5, dm_template_1=$6, dm_template_followup=$7, whatsapp_number=$8,
       max_dm_per_day=$9, window_start_hour=$10, window_end_hour=$11, min_score_to_dm=$12,
       followup_after_hours=$13, active=$14, updated_at=NOW() WHERE id=$1 RETURNING id`,
      [id, data.icp_description, data.icp_hashtags, data.icp_competitors, data.verified_claims,
        data.dm_template_1, data.dm_template_followup || null, data.whatsapp_number,
        data.max_dm_per_day, data.window_start_hour, data.window_end_hour, data.min_score_to_dm,
        data.followup_after_hours, data.active],
    );
    if (!result.rows[0]) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
    await audit("campaign.updated", { campaignId: id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro interno." }, { status: 500 });
  }
}
