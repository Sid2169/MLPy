export default function ChapterLoading() {
  return (
    <section aria-busy="true" aria-label="Loading chapter" className="space-y-6 py-6">
      <p role="status" className="text-sm font-medium text-indigo-600 dark:text-indigo-300">Loading chapter…</p>
      <div aria-hidden="true" className="animate-pulse space-y-6 motion-reduce:animate-none">
        <div className="h-10 w-3/4 rounded-lg bg-slate-200 dark:bg-slate-800" />
        <div className="h-4 w-1/2 rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-2 w-full rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-60 rounded-xl bg-slate-200 dark:bg-slate-800" />
      </div>
    </section>
  );
}
