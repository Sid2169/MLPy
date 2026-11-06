"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { BookMarked, FileText, GraduationCap } from "lucide-react";
import { useProgress } from "@/components/progress-provider";

export type SidebarChapter = {
  number: number;
  slug: string;
  title: string;
  totalExercises: number;
};

type SidebarContentProps = {
  chapters: SidebarChapter[];
  onNavigate?: () => void;
  className?: string;
};

export function SidebarContent({
  chapters,
  onNavigate,
  className,
}: SidebarContentProps) {
  const pathname = usePathname();
  const { hydrated, getCompletedCount } = useProgress();
  const totalExercises = chapters.reduce(
    (total, chapter) => total + chapter.totalExercises,
    0,
  );
  const completedExercises = chapters.reduce(
    (total, chapter) =>
      total +
      Math.min(
        hydrated ? getCompletedCount(chapter.slug) : 0,
        chapter.totalExercises,
      ),
    0,
  );
  const percent =
    totalExercises === 0
      ? 0
      : Math.round((completedExercises / totalExercises) * 100);

  return (
    <div className={clsx("flex h-full flex-col", className)}>
      <div className="border-b border-slate-200 px-5 py-5 dark:border-slate-800">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-sm font-black text-white shadow-sm">
            ML
          </span>
          <span>
            <span className="block text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">
              MLPy
            </span>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">
              Applied AI &amp; Backend
            </span>
          </span>
        </Link>
      </div>

      <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
          <span>Course progress</span>
          <span>{percent}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div
            className="h-full rounded-full bg-indigo-600 transition-[width] duration-300 dark:bg-indigo-500"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-500">
          {completedExercises} of {totalExercises} exercises complete
        </p>
      </div>

      <nav
        className="flex-1 overflow-y-auto px-3 py-4"
        aria-label="Course chapters"
      >
        <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-500">
          Chapters
        </p>
        <ul className="space-y-0.5">
          {chapters.map((chapter) => {
            const href = `/chapters/${chapter.slug}`;
            const active = pathname === href;
            const completed = hydrated
              ? Math.min(
                  getCompletedCount(chapter.slug),
                  chapter.totalExercises,
                )
              : 0;

            return (
              <li key={chapter.slug}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={clsx(
                    "group flex items-start gap-2.5 rounded-lg px-2 py-2 text-sm transition",
                    active
                      ? "bg-indigo-50 text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100",
                  )}
                >
                  <span
                    className={clsx(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold",
                      active
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-100 text-slate-500 group-hover:bg-white dark:bg-slate-800 dark:text-slate-400 dark:group-hover:bg-slate-700",
                    )}
                  >
                    {chapter.number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block leading-5">{chapter.title}</span>
                    <span className="mt-1 block text-[10px] text-slate-400 dark:text-slate-500">
                      {completed}/{chapter.totalExercises} exercises
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="mt-6 px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-500">
          Reference
        </p>
        <ul className="space-y-0.5">
          <li>
            <Link
              href="/curriculum"
              onClick={onNavigate}
              className={clsx(
                "flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition",
                pathname === "/curriculum"
                  ? "bg-indigo-50 text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100",
              )}
            >
              <GraduationCap className="h-4 w-4" aria-hidden="true" />
              Curriculum
            </Link>
          </li>
          <li>
            <Link
              href="/chapter-generation"
              onClick={onNavigate}
              className={clsx(
                "flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition",
                pathname === "/chapter-generation"
                  ? "bg-indigo-50 text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100",
              )}
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              Chapter generation
            </Link>
          </li>
          <li>
            <span className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-slate-500 dark:text-slate-500">
              <BookMarked className="h-4 w-4" aria-hidden="true" />
              Solutions withheld
            </span>
          </li>
        </ul>
      </nav>

      <div className="border-t border-slate-200 px-5 py-4 text-[11px] leading-5 text-slate-500 dark:border-slate-800 dark:text-slate-500">
        Built for TypeScript and Node.js developers moving into applied Python.
      </div>
    </div>
  );
}

export function SiteSidebar({ chapters }: { chapters: SidebarChapter[] }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 lg:block">
      <SidebarContent chapters={chapters} />
    </aside>
  );
}
