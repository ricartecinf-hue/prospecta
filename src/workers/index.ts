const workers = [
  "prospector",
  "qualifier",
  "outreach",
  "followup",
  "inbox",
  "handoff",
] as const;

async function start() {
  console.info(`[Prospecta] iniciando ${workers.length} workers no processo prospecta-jobs`);
  await Promise.all([
    import("./prospector"),
    import("./qualifier"),
    import("./outreach"),
    import("./followup"),
    import("./inbox"),
    import("./handoff"),
  ]);
  console.info(`[Prospecta] workers ativos: ${workers.join(", ")}`);
}

start().catch((error) => {
  console.error("[Prospecta] falha ao iniciar os workers", error);
  process.exitCode = 1;
});
