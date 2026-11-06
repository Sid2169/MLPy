"use client";

import Link from "next/link";
import { useProgress } from "@/components/progress-provider";

export function ResumeLearning() {
  const { hydrated, lastVisited } = useProgress();
  if (!hydrated || !lastVisited) return null;
  return <Link
    className="rounded-xl border border-indigo-300 px-5 py-2.5 text-sm font-semibold text-indigo-700 dark:text-indigo-300"
    href={lastVisited.chapterSlug === "fundamentals" ? `/practice/fundamentals/${lastVisited.exerciseId}` : `/chapters/${lastVisited.chapterSlug}#exercise-${lastVisited.exerciseId.toLowerCase()}`}
  >Resume exercise {lastVisited.label.replace(/^Exercise /, "")}</Link>;
}
