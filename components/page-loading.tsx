export function PageLoading({ label = "Loading page…" }: { label?: string }) {
  return (
    <section aria-busy="true" aria-label={label} className="space-y-6 py-6">
      <p role="status" className="flex items-center gap-2 text-sm font-medium text-indigo-600 dark:text-indigo-300">
        <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600 motion-reduce:animate-none dark:border-indigo-900 dark:border-t-indigo-300" />
        {label}
      </p>
      <div aria-hidden="true" className="animate-pulse space-y-6 motion-reduce:animate-none">
        <div className="h-10 w-3/4 rounded-lg bg-slate-200 dark:bg-slate-800" />
        <div className="h-4 w-1/2 rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-2 w-full rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-60 rounded-xl bg-slate-200 dark:bg-slate-800" />
      </div>
    </section>
  );
}
