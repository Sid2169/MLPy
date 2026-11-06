import Link from "@/components/navigation-link";
import { getChapterMetas } from "@/lib/content";
import { SiteHeader } from "@/components/site-header";
import {
  SiteSidebar,
  type SidebarChapter,
} from "@/components/sidebar-nav";

export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const chapters: SidebarChapter[] = getChapterMetas().map((chapter) => ({
    number: chapter.number,
    slug: chapter.slug,
    title: chapter.title,
    totalExercises: chapter.exercises.length,
  }));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <a
        href="#main-content"
        className="skip-link"
      >
        Skip to content
      </a>
      <SiteSidebar chapters={chapters} />
      <div className="lg:pl-72">
        <SiteHeader chapters={chapters} />
        <main
          id="main-content"
          className="mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10"
        >
          {children}
        </main>
        <footer className="border-t border-slate-200 px-4 py-8 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-[1440px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p>
              MLPy — Python for Applied AI and Backend Engineering.
            </p>
            <div className="flex items-center gap-4">
              <Link
                href="/curriculum"
                className="transition hover:text-slate-900 dark:hover:text-slate-100"
              >
                Curriculum
              </Link>
              <Link
                href="/chapter-generation"
                className="transition hover:text-slate-900 dark:hover:text-slate-100"
              >
                Chapter generation
              </Link>
              <a
                href="https://github.com/Sid2169/MLPy"
                target="_blank"
                rel="noreferrer"
                className="transition hover:text-slate-900 dark:hover:text-slate-100"
              >
                GitHub
              </a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
