import Link from "@/components/navigation-link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getChapter, getChapterExercises, getChapterLinkMap, getChapterMetas, getPrevNextChapter } from "@/lib/content";
import { initialExerciseDraft, interactionFor, profileFor, workspaceHref } from "@/lib/exercise-workspaces";
import { renderMarkdown } from "@/lib/mdx";
import { ExerciseWorkspace } from "@/components/exercise-workspace";

type Props = { params: Promise<{ chapterSlug: string; exerciseId: string }> };

export const dynamicParams = false;
export function generateStaticParams() {
  return getChapterMetas().flatMap((chapter) => chapter.exercises.map((exercise) => ({ chapterSlug: chapter.slug, exerciseId: exercise.id })));
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { chapterSlug, exerciseId } = await params;
  const chapter = getChapter(chapterSlug);
  const exercise = getChapterExercises(chapterSlug).find((item) => item.id === exerciseId);
  if (!chapter || !exercise) return { title: "Exercise not found" };
  return { title: `Exercise ${exercise.label} · Chapter ${chapter.number} practice`, description: exercise.prompt.slice(0, 240) };
}

export default async function PracticePage({ params }: Props) {
  const { chapterSlug, exerciseId } = await params;
  const chapter = getChapter(chapterSlug);
  const exercises = getChapterExercises(chapterSlug);
  const index = exercises.findIndex((exercise) => exercise.id === exerciseId);
  const exercise = exercises[index];
  if (!chapter || !exercise) notFound();
  const content = await renderMarkdown(exercise.source, { linkMap: getChapterLinkMap(), interactiveCode: false });
  const previous = exercises[index - 1];
  const next = exercises[index + 1];
  const { previous: previousChapter, next: nextChapter } = getPrevNextChapter(chapterSlug);
  const previousChapterExercise = previousChapter?.exercises.at(-1);
  const nextChapterExercise = nextChapter?.exercises[0];
  return <div className="space-y-6">
    <Link className="text-sm text-indigo-600 dark:text-indigo-300" href={`/chapters/${chapterSlug}#exercise-${exercise.id.toLowerCase()}`}>← Back to lesson</Link>
    <header>
      <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">Chapter {chapter.number} · {interactionFor(exercise)} · {index + 1} of {exercises.length}</p>
      <h1 className="mt-2 text-3xl font-bold">Exercise {exercise.label}</h1>
      <p className="mt-2 text-sm text-slate-500">{chapter.title} · {exercise.group}</p>
    </header>
    <div className="practice-layout">
      <section className="practice-prompt" aria-label="Exercise prompt and reference code"><div className="prose prose-slate max-w-none dark:prose-invert">{content}</div></section>
      <ExerciseWorkspace key={exercise.id} exerciseId={exercise.id} chapterSlug={exercise.chapterSlug} label={exercise.label} interaction={interactionFor(exercise)} profile={profileFor(exercise)} initial={initialExerciseDraft(exercise)} />
    </div>
    <nav aria-label="Exercise navigation" className="flex justify-between gap-4 text-sm font-semibold text-indigo-600 dark:text-indigo-300">
      {previous ? <Link href={workspaceHref(chapterSlug, previous.id)}>← Exercise {previous.label}</Link> : previousChapter && previousChapterExercise ? <Link href={workspaceHref(previousChapter.slug, previousChapterExercise.id)}>← Chapter {previousChapter.number} · exercise {previousChapterExercise.label}</Link> : <span />}
      {next ? <Link href={workspaceHref(chapterSlug, next.id)}>Exercise {next.label} →</Link> : nextChapter && nextChapterExercise ? <Link href={workspaceHref(nextChapter.slug, nextChapterExercise.id)}>Chapter {nextChapter.number} · exercise {nextChapterExercise.label} →</Link> : <Link href="/">Back to course →</Link>}
    </nav>
  </div>;
}
