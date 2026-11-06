import fs from "node:fs";
import path from "node:path";
import { parseMarkdown, splitDocumentTitle } from "./markdown";
import type { Chapter, ChapterMeta } from "./types";

const CONTENT_ROOT = process.cwd();
const CHAPTER_DIRECTORY_PATTERN = /^chapter-(\d+)$/;

export const REFERENCE_DOCUMENTS = [
  {
    key: "curriculum",
    fileName: "Curriculum.md",
    route: "/curriculum",
    title: "Curriculum",
    searchTitle: "Curriculum",
    description:
      "Goals, chapter outlines, outcomes, and completion criteria for the course.",
  },
  {
    key: "chapter-generation",
    fileName: "Chapter-generation.md",
    route: "/chapter-generation",
    title: "Chapter Generation Guide",
    searchTitle: "Chapter Generation Guide",
    description:
      "The specification used to generate each lesson and exercise set.",
  },
] as const;

export type ChapterFile = {
  number: number;
  slug: string;
  fileName: string;
  filePath: string;
  absolutePath: string;
};

export type ReferenceDocument = {
  key: string;
  fileName: string;
  route: string;
  title: string;
  fullTitle: string;
  searchTitle: string;
  description: string;
  body: string;
  headings: ChapterMeta["headings"];
};

export type HomeContent = {
  fullTitle: string;
  title: string;
  description: string;
  introBody: string;
  restBody: string;
};

export function discoverChapterFiles(): ChapterFile[] {
  const entries = fs.readdirSync(/* turbopackIgnore: true */ CONTENT_ROOT, { withFileTypes: true });
  const chapters: ChapterFile[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const match = entry.name.match(CHAPTER_DIRECTORY_PATTERN);
    if (!match) {
      continue;
    }

    const directory = path.join(/* turbopackIgnore: true */ CONTENT_ROOT, entry.name);
    const markdownFiles = fs
      .readdirSync(/* turbopackIgnore: true */ directory, { withFileTypes: true })
      .filter(
        (file) =>
          file.isFile() &&
          file.name.endsWith(".md") &&
          !file.name.includes(".bak"),
      )
      .map((file) => file.name)
      .sort();

    if (markdownFiles.length === 0) {
      continue;
    }

    const fileName = markdownFiles[0];
    chapters.push({
      number: Number(match[1]),
      slug: fileName.replace(/\.md$/, ""),
      fileName,
      filePath: path.posix.join(entry.name, fileName),
      absolutePath: path.join(/* turbopackIgnore: true */ directory, fileName),
    });
  }

  return chapters.sort((a, b) => a.number - b.number);
}

function buildChapterMeta(source: string, file: ChapterFile): ChapterMeta {
  const { fullTitle, title, body } = splitDocumentTitle(source);
  const parsed = parseMarkdown(body);
  const readingMinutes = Math.max(1, Math.round(parsed.wordCount / 200));

  return {
    number: file.number,
    slug: file.slug,
    title: title || fullTitle,
    fullTitle: fullTitle || `Chapter ${file.number}`,
    description: parsed.description,
    fileName: file.fileName,
    filePath: file.filePath,
    headings: parsed.headings.filter((heading) => heading.text !== "Contents"),
    exercises: parsed.exercises.map((exercise) => ({
      id: `ch${file.number}-${exercise.label}`,
      label: exercise.label,
    })),
    wordCount: parsed.wordCount,
    readingMinutes,
  };
}

export function getChapterMetas(): ChapterMeta[] {
  return discoverChapterFiles().map((file) => {
    const source = fs.readFileSync(file.absolutePath, "utf8");
    return buildChapterMeta(source, file);
  });
}

export function getChapter(slug: string): Chapter | null {
  const file = discoverChapterFiles().find((chapter) => chapter.slug === slug);
  if (!file) {
    return null;
  }

  const source = fs.readFileSync(file.absolutePath, "utf8");
  const meta = buildChapterMeta(source, file);
  const { body } = splitDocumentTitle(source);

  return { ...meta, body };
}

export function getChapterLinkMap(): Record<string, string> {
  const linkMap: Record<string, string> = {
    "README.md": "/",
    "Curriculum.md": "/curriculum",
    "Chapter-generation.md": "/chapter-generation",
  };

  for (const chapter of discoverChapterFiles()) {
    linkMap[chapter.filePath] = `/chapters/${chapter.slug}`;
  }

  return linkMap;
}

export function getReferenceDocument(
  fileName: string,
  route: string,
): ReferenceDocument | null {
  const definition = REFERENCE_DOCUMENTS.find(
    (document) => document.fileName === fileName,
  );
  if (!definition) {
    return null;
  }

  const absolutePath = path.join(/* turbopackIgnore: true */ CONTENT_ROOT, fileName);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  const source = fs.readFileSync(absolutePath, "utf8");
  const { fullTitle, title, body } = splitDocumentTitle(source);
  const parsed = parseMarkdown(body);

  return {
    ...definition,
    route,
    title: title || fullTitle || definition.title,
    fullTitle: fullTitle || definition.title,
    description: parsed.description || definition.description,
    body,
    headings: parsed.headings.filter((heading) => heading.text !== "Contents"),
  };
}

export function getHomeContent(): HomeContent {
  const source = fs.readFileSync(path.join(CONTENT_ROOT, "README.md"), "utf8");
  const indexMarker = "## Index";
  const referenceMarker = "## Reference documents";
  const indexPosition = source.indexOf(indexMarker);
  const referencePosition = source.indexOf(referenceMarker);

  const introSource =
    indexPosition === -1 ? source : source.slice(0, indexPosition);
  const restSource =
    referencePosition === -1 ? "" : source.slice(referencePosition);

  const { fullTitle, title, body } = splitDocumentTitle(introSource);
  const parsed = parseMarkdown(body);

  return {
    fullTitle: fullTitle || "MLPy",
    title: title || fullTitle || "MLPy",
    description:
      parsed.description ||
      "A self-study course for experienced TypeScript and Node.js developers.",
    introBody: body.trim(),
    restBody: restSource.trim(),
  };
}

export function getPrevNextChapter(slug: string): {
  previous: ChapterMeta | null;
  next: ChapterMeta | null;
} {
  const chapters = getChapterMetas();
  const index = chapters.findIndex((chapter) => chapter.slug === slug);

  return {
    previous: index > 0 ? chapters[index - 1] : null,
    next: index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : null,
  };
}

export function getChapterByNumber(number: number): ChapterMeta | null {
  return (
    getChapterMetas().find((chapter) => chapter.number === number) ?? null
  );
}
