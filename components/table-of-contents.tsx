"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ListTree } from "lucide-react";
import type { TocHeading } from "@/lib/types";

function useTocState(headings: TocHeading[]) {
  const items = useMemo(
    () => headings.filter((heading) => heading.level <= 2),
    [headings],
  );
  const [activeId, setActiveId] = useState(items[0]?.id ?? "");

  useEffect(() => {
    const elements = items
      .map((item) => document.getElementById(item.id))
      .filter((element): element is HTMLElement => Boolean(element));

    if (elements.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible[0]) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        rootMargin: "-96px 0px -68% 0px",
        threshold: [0, 1],
      },
    );

    for (const element of elements) {
      observer.observe(element);
    }

    return () => observer.disconnect();
  }, [items]);

  return { items, activeId, setActiveId };
}

export function TableOfContents({ headings }: { headings: TocHeading[] }) {
  const { items, activeId, setActiveId } = useTocState(headings);

  if (items.length === 0) {
    return null;
  }

  return (
    <aside className="sticky top-24 hidden max-h-[calc(100vh-8rem)] w-60 shrink-0 overflow-y-auto pb-8 xl:block">
      <TocList items={items} activeId={activeId} onSelect={setActiveId} />
    </aside>
  );
}

export function MobileTableOfContents({
  headings,
}: {
  headings: TocHeading[];
}) {
  const { items, activeId, setActiveId } = useTocState(headings);

  if (items.length === 0) {
    return null;
  }

  return (
    <details className="mb-8 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 xl:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-slate-900 marker:content-none dark:text-slate-100">
        <ListTree className="h-4 w-4" aria-hidden="true" />
        On this page
      </summary>
      <div className="mt-3">
        <TocList items={items} activeId={activeId} onSelect={setActiveId} />
      </div>
    </details>
  );
}

function TocList({
  items,
  activeId,
  onSelect,
}: {
  items: TocHeading[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav aria-label="On this page">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-500">
        On this page
      </p>
      <ul className="space-y-0.5 border-l border-slate-200 dark:border-slate-800">
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                onClick={() => onSelect(item.id)}
                aria-current={active ? "location" : undefined}
                className={clsx(
                  "-ml-px block border-l-2 py-1.5 pl-3 text-[13px] leading-5 transition",
                  active
                    ? "border-indigo-600 font-medium text-indigo-700 dark:border-indigo-400 dark:text-indigo-300"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-200",
                )}
              >
                {item.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
