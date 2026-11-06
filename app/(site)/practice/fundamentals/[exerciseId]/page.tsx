import Link from "@/components/navigation-link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getChapter, getChapterLinkMap } from "@/lib/content";
import { extractExercises, type ExerciseDefinition } from "@/lib/exercises";
import { initialExerciseDraft, interactionFor } from "@/lib/chapter-one-exercises";
import { renderMarkdown } from "@/lib/mdx";
import { ExerciseWorkspace } from "@/components/exercise-workspace";

let exerciseCache: ExerciseDefinition[] | undefined;
function getExercises() {
  if (process.env.NODE_ENV === "production" && exerciseCache) return exerciseCache;
  const chapter = getChapter("fundamentals");
  const exercises = chapter ? extractExercises(chapter.body, 1, chapter.slug) : [];
  if (process.env.NODE_ENV === "production") exerciseCache = exercises;
  return exercises;
}

export const dynamicParams = false;
export function generateStaticParams() {
  return getExercises().map((exercise) => ({ exerciseId: exercise.id }));
}
export async function generateMetadata({ params }: { params: Promise<{ exerciseId: string }> }): Promise<Metadata> {
  const { exerciseId } = await params;
  return { title: `Exercise ${exerciseId.replace("ch1-", "")} · Chapter 1 practice` };
}

export default async function PracticePage({ params }: { params: Promise<{ exerciseId: string }> }) {
  const { exerciseId } = await params;
  const exercises = getExercises();
  const index = exercises.findIndex((exercise) => exercise.id === exerciseId);
  const exercise = exercises[index];
  if (!exercise) notFound();
  const content = await renderMarkdown(exercise.source, { linkMap: getChapterLinkMap(), interactiveCode: false });
  const previous = exercises[index - 1];
  const next = exercises[index + 1];
  return <div className="space-y-6">
    <Link className="text-sm text-indigo-600 dark:text-indigo-300" href={`/chapters/fundamentals#exercise-${exercise.id.toLowerCase()}`}>← Back to lesson</Link>
    <header>
      <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">Chapter 1 · {interactionFor(exercise.label)} · {index + 1} of {exercises.length}</p>
      <h1 className="mt-2 text-3xl font-bold">Exercise {exercise.label}</h1>
    </header>
    <div className="practice-layout">
      <section className="practice-prompt" aria-label="Exercise prompt and reference code"><div className="prose prose-slate max-w-none dark:prose-invert">{content}</div></section>
      <ExerciseWorkspace key={exercise.id} exerciseId={exercise.id} chapterSlug={exercise.chapterSlug} label={exercise.label} interaction={interactionFor(exercise.label)} initial={initialExerciseDraft(exercise)} />
    </div>
    <nav aria-label="Exercise navigation" className="flex justify-between gap-4 text-sm font-semibold text-indigo-600 dark:text-indigo-300">
      {previous ? <Link href={`/practice/fundamentals/${previous.id}`}>← Exercise {previous.label}</Link> : <span />}
      {next ? <Link href={`/practice/fundamentals/${next.id}`}>Exercise {next.label} →</Link> : <Link href="/chapters/functions-objects">Next chapter →</Link>}
    </nav>
  </div>;
}
