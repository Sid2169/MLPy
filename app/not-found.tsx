import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
        404
      </p>
      <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 dark:text-white">
        Page not found
      </h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-slate-600 dark:text-slate-400">
        The page you are looking for does not exist. Return to the course index
        and pick a chapter.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
      >
        Back to the course
      </Link>
    </div>
  );
}
