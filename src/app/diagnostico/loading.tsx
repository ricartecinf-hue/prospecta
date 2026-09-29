export default function DiagnosticsLoading() {
  return (
    <div className="animate-pulse space-y-7" aria-label="Carregando diagnóstico">
      <div className="h-20 w-full max-w-md rounded bg-slate-200" />
      <div className="h-28 rounded-2xl bg-slate-200" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-28 rounded-2xl bg-slate-200" />)}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-80 rounded-2xl bg-slate-200" />
        <div className="h-80 rounded-2xl bg-slate-200" />
      </div>
    </div>
  );
}
