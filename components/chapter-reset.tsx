"use client";

import { RotateCcw } from "lucide-react";
import { useProgress } from "@/components/progress-provider";

export function ChapterReset({ chapterSlug }: { chapterSlug: string }) {
  const { resetChapter, hydrated } = useProgress();

  if (!hydrated) {
    return null;
  }

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      onClick={() => {
        if (
          window.confirm(
            "Reset all exercise progress and notes for this chapter?",
          )
        ) {
          resetChapter(chapterSlug);
        }
      }}
    >
      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
      Reset chapter
    </button>
  );
}
