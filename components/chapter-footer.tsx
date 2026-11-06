import Link from "@/components/navigation-link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ChapterMeta } from "@/lib/types";

export function ChapterFooter({
  previous,
  next,
}: {
  previous: ChapterMeta | null;
  next: ChapterMeta | null;
}) {
  return (
    <nav
      className="mt-16 grid gap-3 border-t border-slate-200 pt-8 sm:grid-cols-2 dark:border-slate-800"
      aria-label="Chapter navigation"
    >
      {previous ? (
        <Link
          href={`/chapters/${previous.slug}`}
          className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-indigo-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-700"
        >
          <ArrowLeft
            className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition group-hover:-translate-x-0.5 group-hover:text-indigo-500"
            aria-hidden="true"
          />
          <span>
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-500">
              Previous
            </span>
            <span className="mt-0.5 block text-sm font-semibold text-slate-900 dark:text-slate-100">
              Chapter {previous.number} — {previous.title}
            </span>
          </span>
        </Link>
      ) : (
        <span className="hidden sm:block" />
      )}

      {next ? (
        <Link
          href={`/chapters/${next.slug}`}
          className="group flex items-start justify-end gap-3 rounded-xl border border-slate-200 bg-white p-4 text-right transition hover:border-indigo-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-700"
        >
          <span>
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-500">
              Next
            </span>
            <span className="mt-0.5 block text-sm font-semibold text-slate-900 dark:text-slate-100">
              Chapter {next.number} — {next.title}
            </span>
          </span>
          <ArrowRight
            className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-indigo-500"
            aria-hidden="true"
          />
        </Link>
      ) : null}
    </nav>
  );
}
