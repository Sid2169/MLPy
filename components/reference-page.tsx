import { FileText } from "lucide-react";
import {
  MobileTableOfContents,
  TableOfContents,
} from "@/components/table-of-contents";
import type { ReferenceDocument } from "@/lib/content";
import { getChapterLinkMap } from "@/lib/content";
import { renderMarkdown } from "@/lib/mdx";

export async function ReferencePage({
  document,
  eyebrow,
}: {
  document: ReferenceDocument;
  eyebrow: string;
}) {
  const content = await renderMarkdown(document.body, {
    linkMap: getChapterLinkMap(),
  });

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_15rem] xl:gap-10">
      <div className="min-w-0">
        <header className="mb-8 border-b border-slate-200 pb-8 dark:border-slate-800">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            {eyebrow}
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 dark:text-white sm:text-4xl">
            {document.title}
          </h1>
        </header>

        <MobileTableOfContents headings={document.headings} />

        <article className="prose prose-slate max-w-none dark:prose-invert">
          {content}
        </article>
      </div>

      <TableOfContents headings={document.headings} />
    </div>
  );
}
