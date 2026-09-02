import { NextResponse } from "next/server";
import { resumeAutomation } from "@/lib/circuit-breaker";

export async function POST() {
  await resumeAutomation();
  return NextResponse.json({ ok: true });
}
