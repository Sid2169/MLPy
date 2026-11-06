"use client";

import clsx from "clsx";
import { useProgress } from "@/components/progress-provider";

type ChapterProgressProps = {
  chapterSlug: string;
  chapterNumber: number;
  totalExercises: number;
  exerciseIds?: string[];
  className?: string;
  showLabel?: boolean;
};

export function ChapterProgress({
  chapterSlug,
  chapterNumber,
  totalExercises,
  exerciseIds,
  className,
  showLabel = true,
}: ChapterProgressProps) {
  const { hydrated, getCompletedCount } = useProgress();
  const completed = hydrated
    ? Math.min(
        exerciseIds
          ? getCompletedCount(chapterSlug, exerciseIds)
          : getCompletedCount(chapterSlug),
        totalExercises,
      )
    : 0;
  const percent =
    totalExercises === 0 ? 0 : Math.round((completed / totalExercises) * 100);

  return (
    <div className={clsx("chapter-progress", className)}>
      {showLabel ? (
        <div className="chapter-progress-label">
          <span>
            {completed} / {totalExercises} exercises
          </span>
          <span>{percent}%</span>
        </div>
      ) : null}
      <div
        className="chapter-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={totalExercises}
        aria-valuenow={completed}
        aria-label={`Chapter ${chapterNumber} exercise progress`}
      >
        <div
          className="chapter-progress-fill"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
