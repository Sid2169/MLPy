import fs from "node:fs";
import path from "node:path";
import {
  getChapter,
  getChapterMetas,
  getReferenceDocument,
} from "../lib/content";
import { getSectionDocuments } from "../lib/markdown";
import type { SearchDocument, SearchIndexFile } from "../lib/types";

function buildIndex() {
  const documents: SearchDocument[] = [];
  const seenIds = new Set<string>();

  const addDocument = (document: SearchDocument) => {
    let id = document.id;
    let suffix = 2;
    while (seenIds.has(id)) {
      id = `${document.id}-${suffix}`;
      suffix += 1;
    }
    seenIds.add(id);
    documents.push({ ...document, id });
  };

  for (const meta of getChapterMetas()) {
    const chapter = getChapter(meta.slug);
    if (!chapter) {
      continue;
    }

    const sections = getSectionDocuments(chapter.body, {
      route: `/chapters/${chapter.slug}`,
      chapterSlug: chapter.slug,
      chapterNumber: chapter.number,
      chapterTitle: chapter.title,
    });

    for (const section of sections) {
      if (!section.text && !section.heading) {
        continue;
      }

      addDocument({
        id: `/chapters/${chapter.slug}#${section.anchor || "overview"}`,
        route: `/chapters/${chapter.slug}`,
        chapterSlug: chapter.slug,
        chapterNumber: chapter.number,
        chapterTitle: chapter.title,
        heading: section.heading,
        anchor: section.anchor,
        text: section.text,
      });
    }
  }

  for (const reference of [
    getReferenceDocument("Curriculum.md", "/curriculum"),
    getReferenceDocument(
      "Chapter-generation.md",
      "/chapter-generation",
    ),
  ]) {
    if (!reference) {
      continue;
    }

    const sections = getSectionDocuments(reference.body, {
      route: reference.route,
      chapterSlug: reference.key,
      chapterNumber: 0,
      chapterTitle: reference.searchTitle,
    });

    for (const section of sections) {
      if (!section.text && !section.heading) {
        continue;
      }

      addDocument({
        id: `${reference.route}#${section.anchor || "overview"}`,
        route: reference.route,
        chapterSlug: reference.key,
        chapterNumber: 0,
        chapterTitle: reference.searchTitle,
        heading: section.heading,
        anchor: section.anchor,
        text: section.text,
      });
    }
  }

  const index: SearchIndexFile = { version: 1, documents };
  const outputDirectory = path.join(process.cwd(), "public");
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(outputDirectory, "search-index.json"),
    JSON.stringify(index),
    "utf8",
  );

  const size = fs.statSync(path.join(outputDirectory, "search-index.json")).size;
  console.log(
    `Built search index: ${documents.length} documents, ${(size / 1024).toFixed(1)} KB.`,
  );
}

buildIndex();
