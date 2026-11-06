import Link from "next/link";
import { ArrowRight, Clock, Layers, ListChecks } from "lucide-react";
import {
  getChapterLinkMap,
  getChapterMetas,
  getHomeContent,
} from "@/lib/content";
import { renderMarkdown } from "@/lib/mdx";
import { ChapterGrid } from "@/components/chapter-grid";

export default async function HomePage() {
  const [home, chapters] = [getHomeContent(), getChapterMetas()];
  const linkMap = getChapterLinkMap();
  const intro = await renderMarkdown(home.introBody, { linkMap });
  const rest = home.restBody
    ? await renderMarkdown(home.restBody, { linkMap })
    : null;
  const totalExercises = chapters.reduce(
    (total, chapter) => total + chapter.exercises.length,
    0,
  );

  return (
    <div>
      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-10 lg:p-12">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-indigo-100 blur-3xl dark:bg-indigo-500/10"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-sky-100 blur-3xl dark:bg-sky-500/10"
          aria-hidden="true"
        />
        <div className="relative max-w-3xl">
          <p className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300">
            Self-study course
          </p>
          <h1 className="mt-5 text-4xl font-black tracking-tight text-slate-950 dark:text-white sm:text-5xl lg:text-6xl">
            {home.fullTitle}
          </h1>
          <div className="prose prose-slate mt-5 max-w-2xl dark:prose-invert prose-p:text-base prose-p:leading-7">
            {intro}
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href={`/chapters/${chapters[0]?.slug ?? "fundamentals"}`}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
            >
              Start Chapter 1
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href="/curriculum"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:text-white"
            >
              Read the curriculum
            </Link>
          </div>

          <dl className="mt-9 grid max-w-xl grid-cols-3 gap-4 border-t border-slate-200 pt-5 dark:border-slate-800">
            <div>
              <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                Chapters
              </dt>
              <dd className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">
                {chapters.length}
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
                Exercises
              </dt>
              <dd className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">
                {totalExercises.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                Focused hours
              </dt>
              <dd className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">
                25–35
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="chapters-heading">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              id="chapters-heading"
              className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white"
            >
              Chapters
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Twelve standalone lessons, ordered from Python fundamentals to
              deployment and observability.
            </p>
          </div>
          <Link
            href="/curriculum"
            className="text-sm font-semibold text-indigo-600 transition hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
          >
            View full curriculum →
          </Link>
        </div>

        <ChapterGrid
          chapters={chapters.map((chapter) => ({
            number: chapter.number,
            slug: chapter.slug,
            title: chapter.title,
            description: chapter.description,
            totalExercises: chapter.exercises.length,
            readingMinutes: chapter.readingMinutes,
          }))}
        />
      </section>

      {rest ? (
        <section className="mt-12 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8">
          <div className="prose prose-slate max-w-none dark:prose-invert">
            {rest}
          </div>
        </section>
      ) : null}
    </div>
  );
}
