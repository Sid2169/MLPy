import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, Clock, FileText, ListChecks } from "lucide-react";
import { ChapterFooter } from "@/components/chapter-footer";
import { ChapterProgress } from "@/components/chapter-progress";
import { ChapterReset } from "@/components/chapter-reset";
import {
  MobileTableOfContents,
  TableOfContents,
} from "@/components/table-of-contents";
import {
  getChapter,
  getChapterLinkMap,
  getChapterMetas,
  getPrevNextChapter,
} from "@/lib/content";
import { renderMarkdown } from "@/lib/mdx";

type ChapterPageProps = {
  params: Promise<{ slug: string }>;
};

export const dynamicParams = false;

export function generateStaticParams() {
  return getChapterMetas().map((chapter) => ({ slug: chapter.slug }));
}

export async function generateMetadata({
  params,
}: ChapterPageProps): Promise<Metadata> {
  const { slug } = await params;
  const chapter = getChapter(slug);

  if (!chapter) {
    return { title: "Chapter not found" };
  }

  return {
    title: `Chapter ${chapter.number} — ${chapter.title}`,
    description: chapter.description,
  };
}

export default async function ChapterPage({ params }: ChapterPageProps) {
  const { slug } = await params;
  const chapter = getChapter(slug);

  if (!chapter) {
    notFound();
  }

  const { previous, next } = getPrevNextChapter(chapter.slug);
  const content = await renderMarkdown(chapter.body, {
    chapter,
    linkMap: getChapterLinkMap(),
  });
  const exerciseHeading =
    chapter.headings.find(
      (heading) =>
        heading.text === "Exercises" || heading.text.startsWith("Exercises "),
    ) ?? chapter.headings.find((heading) => heading.text.startsWith("Group "));
  const exerciseIds = chapter.exercises.map((exercise) => exercise.id);

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_15rem] xl:gap-10">
      <div className="min-w-0">
        <div className="mb-6 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
          <Link
            href="/"
            className="transition hover:text-slate-900 dark:hover:text-slate-100"
          >
            Course
          </Link>
          <span aria-hidden="true">/</span>
          <span>Chapter {chapter.number}</span>
        </div>

        <header className="mb-8 border-b border-slate-200 pb-8 dark:border-slate-800">
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            Chapter {chapter.number}
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 dark:text-white sm:text-4xl">
            {chapter.title}
          </h1>

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {chapter.readingMinutes} min read
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
              {chapter.exercises.length} exercises
            </span>
            <span className="inline-flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              {chapter.wordCount.toLocaleString()} words
            </span>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <ChapterProgress
              chapterSlug={chapter.slug}
              chapterNumber={chapter.number}
              totalExercises={chapter.exercises.length}
              exerciseIds={exerciseIds}
              className="w-full max-w-md"
            />
            <div className="flex items-center gap-2">
              {exerciseHeading ? (
                <a
                  href={`#${exerciseHeading.id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-white"
                >
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                  Exercises
                </a>
              ) : null}
              <ChapterReset chapterSlug={chapter.slug} />
            </div>
          </div>
        </header>

        <MobileTableOfContents headings={chapter.headings} />

        <article className="prose prose-slate max-w-none dark:prose-invert">
          {content}
        </article>

        <ChapterFooter previous={previous} next={next} />
      </div>

      <TableOfContents headings={chapter.headings} />
    </div>
  );
}
