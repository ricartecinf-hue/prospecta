export default function DashboardLoading() {
  return (
    <div className="animate-pulse space-y-7" aria-label="Carregando visão geral">
      <div className="space-y-3">
        <div className="h-4 w-24 rounded bg-slate-200" />
        <div className="h-9 w-64 rounded bg-slate-200" />
      </div>
      <div className="h-28 rounded-2xl bg-slate-200" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => <div key={index} className="h-28 rounded-2xl bg-slate-200" />)}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-80 rounded-2xl bg-slate-200" />
        <div className="h-80 rounded-2xl bg-slate-200" />
      </div>
    </div>
  );
}
