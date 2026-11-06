export type WorkspaceDraft = {
  files: Record<string, string>;
  answer: string;
  activeFile: string;
  entrypoint: string;
  stdin: string;
  sourceRevision?: string;
  updatedAt: number;
};

export type LearningState = {
  version: 2;
  completed: Record<string, string[]>;
  notes: Record<string, string>;
  drafts: Record<string, WorkspaceDraft>;
  started: Record<string, boolean>;
  lastVisited: { chapterSlug: string; exerciseId: string; label: string } | null;
};

export function emptyLearningState(): LearningState {
  return { version: 2, completed: {}, notes: {}, drafts: {}, started: {}, lastVisited: null };
}

export function migrateLearningState(value: unknown): LearningState {
  const empty = emptyLearningState();
  if (!value || typeof value !== "object") return empty;
  const data = value as Omit<Partial<LearningState>, "version"> & { version?: number };
  if (data.version !== 1 && data.version !== 2) return empty;
  const strings = (v: unknown): v is Record<string, string> =>
    !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((item) => typeof item === "string");
  if (data.completed && typeof data.completed === "object") {
    for (const [key, ids] of Object.entries(data.completed)) {
      if (Array.isArray(ids)) empty.completed[key] = [...new Set(ids.filter((id): id is string => typeof id === "string"))];
    }
  }
  if (strings(data.notes)) empty.notes = data.notes;
  if (data.version === 2) {
    for (const [key, draft] of Object.entries(data.drafts ?? {})) {
      if (draft && strings(draft.files) && typeof draft.answer === "string" && typeof draft.activeFile === "string") {
        empty.drafts[key] = { ...draft, entrypoint: draft.entrypoint ?? draft.activeFile, stdin: draft.stdin ?? "" };
      }
    }
    for (const [key, started] of Object.entries(data.started ?? {})) {
      if (started === true) empty.started[key] = true;
    }
    const last = data.lastVisited;
    if (last && [last.chapterSlug, last.exerciseId, last.label].every((item) => typeof item === "string")) empty.lastVisited = last;
  }
  return empty;
}

export const exerciseDraftKey = (slug: string, id: string) => `exercise:${slug}:${id}`;
