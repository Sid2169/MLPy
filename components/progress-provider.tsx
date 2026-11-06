"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { emptyLearningState, exerciseDraftKey, type LearningState, type WorkspaceDraft } from "@/lib/learning-state";
import { loadLearningState, saveLearningState } from "@/lib/learning-storage";

type NoteTarget = {
  key: string;
  chapterSlug: string;
  exerciseId: string;
  label: string;
};

type ProgressContextValue = {
  drafts: LearningState["drafts"];
  started: LearningState["started"];
  lastVisited: LearningState["lastVisited"];
  storageStatus: string;
  saveDraft: (key: string, draft: WorkspaceDraft) => void;
  deleteDraft: (key: string) => void;
  visitExercise: (chapterSlug: string, exerciseId: string, label: string) => void;
  startExercise: (chapterSlug: string, exerciseId: string) => void;
  hydrated: boolean;
  completed: Record<string, string[]>;
  getCompletedCount: (
    chapterSlug: string,
    exerciseIds?: string[],
  ) => number;
  isExerciseComplete: (chapterSlug: string, exerciseId: string) => boolean;
  toggleExercise: (chapterSlug: string, exerciseId: string) => void;
  hasNote: (chapterSlug: string, exerciseId: string) => boolean;
  getNote: (chapterSlug: string, exerciseId: string) => string;
  openNote: (
    chapterSlug: string,
    exerciseId: string,
    label: string,
  ) => void;
  resetChapter: (chapterSlug: string) => void;
  resetAll: () => void;
};

const ProgressContext = createContext<ProgressContextValue | null>(null);

export function ProgressProvider({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState<LearningState>(emptyLearningState);
  const [storageStatus, setStorageStatus] = useState("Loading saved work…");
  const [hydrated, setHydrated] = useState(false);
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadLearningState().then(({ state }) => {
      if (cancelled) return;
      setProgress(state);
      setHydrated(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    let cancelled = false;
    setStorageStatus("Saving…");
    saveLearningState(progress).then((backend) => {
      if (!cancelled) setStorageStatus(backend === "indexeddb" ? "Saved in this browser" : "Saved in browser fallback storage");
    }).catch(() => {
      if (!cancelled) setStorageStatus("Unable to save: browser storage is unavailable or full. Keep this page open to retain your work.");
    });
    return () => { cancelled = true; };
  }, [hydrated, progress]);

  const saveDraft = useCallback((key: string, draft: WorkspaceDraft) => {
    setProgress((current) => ({ ...current, drafts: { ...current.drafts, [key]: { ...draft, updatedAt: Date.now() } } }));
  }, []);
  const deleteDraft = useCallback((key: string) => {
    setProgress((current) => {
      const drafts = { ...current.drafts };
      delete drafts[key];
      return { ...current, drafts };
    });
  }, []);
  const visitExercise = useCallback((chapterSlug: string, exerciseId: string, label: string) => {
    setProgress((current) => ({ ...current, lastVisited: { chapterSlug, exerciseId, label } }));
  }, []);
  const startExercise = useCallback((chapterSlug: string, exerciseId: string) => {
    setProgress((current) => ({ ...current, started: { ...current.started, [exerciseDraftKey(chapterSlug, exerciseId)]: true } }));
  }, []);

  useEffect(() => {
    if (!noteTarget) {
      return;
    }

    const timeout = window.setTimeout(() => noteRef.current?.focus(), 20);
    return () => window.clearTimeout(timeout);
  }, [noteTarget]);

  const toggleExercise = useCallback(
    (chapterSlug: string, exerciseId: string) => {
      setProgress((current) => {
        const chapterCompleted = current.completed[chapterSlug] ?? [];
        const complete = chapterCompleted.includes(exerciseId);
        const nextChapterCompleted = complete
          ? chapterCompleted.filter((id) => id !== exerciseId)
          : [...chapterCompleted, exerciseId];

        return {
          ...current,
          completed: {
            ...current.completed,
            [chapterSlug]: nextChapterCompleted,
          },
        };
      });
    },
    [],
  );

  const isExerciseComplete = useCallback(
    (chapterSlug: string, exerciseId: string) =>
      (progress.completed[chapterSlug] ?? []).includes(exerciseId),
    [progress.completed],
  );

  const getCompletedCount = useCallback(
    (chapterSlug: string, exerciseIds?: string[]) => {
      const completed = progress.completed[chapterSlug] ?? [];
      if (!exerciseIds) {
        return completed.length;
      }

      const validIds = new Set(exerciseIds);
      return completed.filter((id) => validIds.has(id)).length;
    },
    [progress.completed],
  );

  const noteKey = (chapterSlug: string, exerciseId: string) =>
    `${chapterSlug}:${exerciseId}`;

  const hasNote = useCallback(
    (chapterSlug: string, exerciseId: string) =>
      Boolean(progress.notes[noteKey(chapterSlug, exerciseId)]?.trim()),
    [progress.notes],
  );

  const getNote = useCallback(
    (chapterSlug: string, exerciseId: string) =>
      progress.notes[noteKey(chapterSlug, exerciseId)] ?? "",
    [progress.notes],
  );

  const openNote = useCallback(
    (chapterSlug: string, exerciseId: string, label: string) => {
      const key = noteKey(chapterSlug, exerciseId);
      setNoteDraft(progress.notes[key] ?? "");
      setNoteTarget({ key, chapterSlug, exerciseId, label });
      visitExercise(chapterSlug, exerciseId, label);
    },
    [progress.notes, visitExercise],
  );

  const saveNote = useCallback(
    (key: string, value: string) => {
      setProgress((current) => {
        const notes = { ...current.notes };
        if (value.trim()) {
          notes[key] = value;
        } else {
          delete notes[key];
        }

        return { ...current, notes };
      });
    },
    [],
  );

  const resetChapter = useCallback((chapterSlug: string) => {
    setProgress((current) => {
      const completed = { ...current.completed };
      const notes = { ...current.notes };
      const drafts = { ...current.drafts };
      const started = { ...current.started };
      delete completed[chapterSlug];

      for (const key of Object.keys(notes)) {
        if (key.startsWith(`${chapterSlug}:`)) {
          delete notes[key];
        }
      }

      for (const key of Object.keys(drafts)) {
        if (key.startsWith(`exercise:${chapterSlug}:`) || key.startsWith(`snippet:/chapters/${chapterSlug}:`)) delete drafts[key];
      }
      for (const key of Object.keys(started)) {
        if (key.startsWith(`exercise:${chapterSlug}:`)) delete started[key];
      }
      return { ...current, completed, notes, drafts, started, lastVisited: current.lastVisited?.chapterSlug === chapterSlug ? null : current.lastVisited };
    });
  }, []);

  const resetAll = useCallback(() => {
    setProgress(emptyLearningState());
  }, []);

  const value = useMemo<ProgressContextValue>(
    () => ({
      hydrated,
      drafts: progress.drafts,
      started: progress.started,
      lastVisited: progress.lastVisited,
      storageStatus,
      saveDraft,
      deleteDraft,
      visitExercise,
      startExercise,
      completed: progress.completed,
      getCompletedCount,
      isExerciseComplete,
      toggleExercise,
      hasNote,
      getNote,
      openNote,
      resetChapter,
      resetAll,
    }),
    [
      getCompletedCount,
      getNote,
      hasNote,
      hydrated,
      isExerciseComplete,
      openNote,
      progress.completed,
      resetAll,
      resetChapter,
      toggleExercise,
      progress.drafts, progress.started, progress.lastVisited, storageStatus,
      saveDraft, deleteDraft, visitExercise, startExercise,
    ],
  );

  return (
    <ProgressContext.Provider value={value}>
      {children}
      {noteTarget ? (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              saveNote(noteTarget.key, noteDraft);
              setNoteTarget(null);
            }
          }}
        >
          <div
            className="w-full max-w-lg rounded-t-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:rounded-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="exercise-note-title"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  Exercise note
                </p>
                <h2
                  id="exercise-note-title"
                  className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100"
                >
                  {noteTarget.label}
                </h2>
              </div>
              <button
                type="button"
                className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                aria-label="Close note"
                onClick={() => {
                  saveNote(noteTarget.key, noteDraft);
                  setNoteTarget(null);
                }}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <textarea
              ref={noteRef}
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              onBlur={() => saveNote(noteTarget.key, noteDraft)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  saveNote(noteTarget.key, noteDraft);
                  setNoteTarget(null);
                }
              }}
              rows={6}
              placeholder="Write a prediction, a bug you hit, or a reminder for later…"
              className="mt-4 w-full resize-y rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {storageStatus}
              </p>
              <button
                type="button"
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                onClick={() => {
                  saveNote(noteTarget.key, noteDraft);
                  setNoteTarget(null);
                }}
              >
                Save note
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ProgressContext.Provider>
  );
}

export function useProgress() {
  const context = useContext(ProgressContext);
  if (!context) {
    throw new Error("useProgress must be used within a ProgressProvider");
  }

  return context;
}
