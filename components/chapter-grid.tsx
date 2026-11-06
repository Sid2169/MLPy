"use client";

import Link from "next/link";
import { ArrowUpRight, BookOpen } from "lucide-react";
import { ChapterProgress } from "@/components/chapter-progress";

export type ChapterGridItem = {
  number: number;
  slug: string;
  title: string;
  description: string;
  totalExercises: number;
  readingMinutes: number;
};

export function ChapterGrid({ chapters }: { chapters: ChapterGridItem[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {chapters.map((chapter) => (
        <Link
          key={chapter.slug}
          href={`/chapters/${chapter.slug}`}
          className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-700"
        >
          <div className="flex items-start justify-between gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-sm font-bold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
              {chapter.number}
            </span>
            <ArrowUpRight
              className="h-4 w-4 text-slate-400 transition group-hover:text-indigo-500 dark:group-hover:text-indigo-400"
              aria-hidden="true"
            />
          </div>
          <h3 className="mt-4 text-base font-semibold leading-snug text-slate-900 dark:text-slate-100">
            {chapter.title}
          </h3>
          <p className="mt-2 line-clamp-3 flex-1 text-sm leading-6 text-slate-600 dark:text-slate-400">
            {chapter.description}
          </p>
          <div className="mt-4 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
              {chapter.readingMinutes} min read
            </span>
            <span aria-hidden="true">·</span>
            <span>{chapter.totalExercises} exercises</span>
          </div>
          <ChapterProgress
            chapterSlug={chapter.slug}
            chapterNumber={chapter.number}
            totalExercises={chapter.totalExercises}
            className="mt-4"
            showLabel={false}
          />
        </Link>
      ))}
    </div>
  );
}
