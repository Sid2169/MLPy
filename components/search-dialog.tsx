"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "@/components/navigation-link";
import { useNavigate } from "@/components/navigation-provider";
import clsx from "clsx";
import { ArrowUpRight, Loader2, Search, X } from "lucide-react";
import type MiniSearch from "minisearch";
import type { SearchDocument, SearchIndexFile } from "@/lib/types";

type SearchResult = {
  id: string;
  score: number;
  route: string;
  anchor: string;
  chapterTitle: string;
  heading: string;
  text: string;
  chapterNumber: number;
};

type MiniSearchInstance = MiniSearch<SearchDocument>;

export function SearchDialog() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const indexRef = useRef<MiniSearchInstance | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const loadIndex = useCallback(async () => {
    if (indexRef.current || status === "loading") {
      return;
    }

    setStatus("loading");
    try {
      const [{ default: MiniSearch }, response] = await Promise.all([
        import("minisearch"),
        fetch("/search-index.json"),
      ]);

      if (!response.ok) {
        throw new Error(`Search index failed: ${response.status}`);
      }

      const data = (await response.json()) as SearchIndexFile;
      const miniSearch = new MiniSearch<SearchDocument>({
        fields: ["heading", "text", "chapterTitle"],
        storeFields: [
          "route",
          "anchor",
          "chapterTitle",
          "heading",
          "text",
          "chapterNumber",
        ],
        idField: "id",
        searchOptions: {
          boost: { heading: 2.5, chapterTitle: 1.4 },
          prefix: true,
          fuzzy: 0.2,
        },
      });

      miniSearch.addAll(data.documents);
      indexRef.current = miniSearch;
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [status]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadIndex();
      inputRef.current?.focus();
    }, 20);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.clearTimeout(timeout);
      document.body.style.overflow = previousOverflow;
    };
  }, [loadIndex, open]);

  const runSearch = useCallback((value: string) => {
    if (!indexRef.current || !value.trim()) {
      setResults([]);
      setActiveIndex(0);
      return;
    }

    const found = indexRef.current.search(value, {
      prefix: true,
      fuzzy: 0.2,
      boost: { heading: 2.5, chapterTitle: 1.4 },
    }) as unknown as SearchResult[];

    setResults(found.slice(0, 14));
    setActiveIndex(0);
  }, []);

  useEffect(() => {
    if (status === "ready") {
      runSearch(query);
    }
  }, [query, runSearch, status]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-result-index="${activeIndex}"]`,
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
  }, []);

  const goToResult = useCallback(
    (result: SearchResult) => {
      close();
      navigate(`${result.route}${result.anchor ? `#${result.anchor}` : ""}`);
    },
    [close, navigate],
  );

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      close();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) =>
        results.length === 0 ? 0 : (index + 1) % results.length,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        results.length === 0
          ? 0
          : (index - 1 + results.length) % results.length,
      );
      return;
    }

    if (event.key === "Enter" && results[activeIndex]) {
      event.preventDefault();
      goToResult(results[activeIndex]);
    }
  };

  return (
    <>
      <button
        type="button"
        className="search-trigger"
        onClick={() => setOpen(true)}
        aria-label="Search the course"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden md:inline-flex" aria-hidden="true">
          Ctrl K
        </kbd>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[90] flex items-start justify-center bg-slate-950/50 p-4 pt-[8vh] backdrop-blur-sm sm:p-6 sm:pt-[12vh]"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              close();
            }
          }}
        >
          <div
            className="flex max-h-[75vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby="search-dialog-title"
          >
            <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <Search
                className="h-4 w-4 shrink-0 text-slate-400"
                aria-hidden="true"
              />
              <h2 id="search-dialog-title" className="sr-only">
                Search the course
              </h2>
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onInputKeyDown}
                type="search"
                placeholder="Search chapters, sections, and exercises…"
                className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="icon-button"
                onClick={close}
                aria-label="Close search"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div ref={listRef} className="min-h-28 flex-1 overflow-y-auto p-2">
              {status === "loading" ? (
                <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-slate-500 dark:text-slate-400">
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                  Loading search index…
                </div>
              ) : status === "error" ? (
                <p className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                  Search is unavailable right now. Try reloading the page.
                </p>
              ) : !query.trim() ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                  Search all 12 chapters by topic, section, or exercise number.
                </div>
              ) : results.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                  No matches for “{query}”.
                </p>
              ) : (
                <ul className="space-y-1">
                  {results.map((result, index) => (
                    <li key={result.id}>
                      <Link
                        href={`${result.route}${result.anchor ? `#${result.anchor}` : ""}`}
                        onClick={close}
                        onMouseEnter={() => setActiveIndex(index)}
                        data-result-index={index}
                        className={clsx(
                          "block rounded-xl px-3 py-2.5 transition",
                          index === activeIndex
                            ? "bg-indigo-50 dark:bg-indigo-500/10"
                            : "hover:bg-slate-100 dark:hover:bg-slate-800/70",
                        )}
                      >
                        <span className="flex items-start justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-500">
                              {result.chapterNumber > 0
                                ? `Chapter ${result.chapterNumber}`
                                : "Reference"}{" "}
                              · {result.chapterTitle}
                            </span>
                            <span className="mt-0.5 block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {result.heading || "Overview"}
                            </span>
                            <span className="mt-1 line-clamp-2 block text-xs leading-5 text-slate-600 dark:text-slate-400">
                              {buildSnippet(result.text, query)}
                            </span>
                          </span>
                          <ArrowUpRight
                            className="mt-1 h-4 w-4 shrink-0 text-slate-400"
                            aria-hidden="true"
                          />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-2.5 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-500">
              <span>↑↓ navigate · Enter open · Esc close</span>
              <span>Ctrl K</span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function buildSnippet(text: string, query: string): string {
  if (!text) {
    return "";
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase().trim();
  const index = lowerQuery ? lowerText.indexOf(lowerQuery) : -1;

  if (index === -1) {
    return text.slice(0, 160);
  }

  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + lowerQuery.length + 100);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}
