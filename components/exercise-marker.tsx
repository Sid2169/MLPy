"use client";

import { Link2, StickyNote } from "lucide-react";
import Link from "next/link";
import { useProgress } from "@/components/progress-provider";
import { exerciseDraftKey } from "@/lib/learning-state";

type ExerciseMarkerProps = {
  chapterSlug: string;
  exerciseId: string;
  label: string;
};

export function ExerciseMarker({
  chapterSlug,
  exerciseId,
  label,
}: ExerciseMarkerProps) {
  const {
    hydrated,
    isExerciseComplete,
    toggleExercise,
    hasNote,
    openNote,
    visitExercise, started,
  } = useProgress();
  const complete = isExerciseComplete(chapterSlug, exerciseId);
  const noted = hasNote(chapterSlug, exerciseId);
  const anchor = `exercise-${exerciseId.toLowerCase()}`;

  return (
    <div
      className="exercise-marker"
      data-complete={complete ? "true" : "false"}
    >
      <label className="exercise-marker-label">
        <input
          type="checkbox"
          checked={complete}
          disabled={!hydrated}
          onChange={() => {
            visitExercise(chapterSlug, exerciseId, label);
            toggleExercise(chapterSlug, exerciseId);
          }}
          className="exercise-checkbox"
          aria-label={`Mark exercise ${label} complete`}
        />
        <span className="exercise-marker-id">{label}</span>
        <span className="exercise-marker-text">
          {complete ? "Complete" : started[exerciseDraftKey(chapterSlug, exerciseId)] ? "In progress · mark complete" : "Mark complete"}
        </span>
      </label>
      <div className="exercise-marker-actions">
        {chapterSlug === "fundamentals" ? <Link
          href={`/practice/fundamentals/${exerciseId}`}
          className="exercise-icon-button text-xs"
          onClick={() => visitExercise(chapterSlug, exerciseId, label)}
          aria-label={`Open workspace for exercise ${label}`}
        >Open workspace</Link> : null}
        <button
          type="button"
          className="exercise-icon-button"
          onClick={() => openNote(chapterSlug, exerciseId, `Exercise ${label}`)}
          aria-label={`${noted ? "Edit" : "Add"} note for exercise ${label}`}
          title={noted ? "Edit note" : "Add note"}
        >
          <StickyNote className="h-3.5 w-3.5" aria-hidden="true" />
          {noted ? <span className="exercise-note-dot" aria-hidden="true" /> : null}
        </button>
        <a
          href={`#${anchor}`}
          className="exercise-icon-button"
          aria-label={`Link to exercise ${label}`}
          title={`Link to exercise ${label}`}
        >
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
