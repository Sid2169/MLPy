import GithubSlugger from "github-slugger";
import { toString } from "mdast-util-to-string";
import type { Heading, Link, Paragraph, Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import type { TocHeading } from "./types";

const EXERCISE_PATTERN = /^([A-Z][A-Z0-9]*[0-9]+)\.\s/;

export const markdownParser = unified().use(remarkParse).use(remarkGfm);

export type ParsedMarkdown = {
  headings: TocHeading[];
  exercises: { label: string }[];
  description: string;
  wordCount: number;
};

export type MarkdownLink = {
  url: string;
  title?: string | null;
};

export function splitDocumentTitle(source: string): {
  fullTitle: string;
  title: string;
  body: string;
} {
  const lines = source.split(/\r?\n/);
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstContentIndex === -1) {
    return { fullTitle: "", title: "", body: "" };
  }

  const firstLine = lines[firstContentIndex].trim();
  if (!firstLine.startsWith("# ")) {
    return { fullTitle: "", title: "", body: source };
  }

  const fullTitle = firstLine.replace(/^#\s+/, "").trim();
  const titleParts = fullTitle.split(/\s+—\s+/);
  const title =
    titleParts.length > 1
      ? titleParts.slice(1).join(" — ").trim()
      : fullTitle.replace(/^Chapter\s+\d+\s*[-—:]\s*/i, "").trim();

  let bodyStart = firstContentIndex + 1;
  while (bodyStart < lines.length && lines[bodyStart].trim() === "") {
    bodyStart += 1;
  }

  return {
    fullTitle,
    title,
    body: lines.slice(bodyStart).join("\n"),
  };
}

export function parseMarkdown(source: string): ParsedMarkdown {
  const tree = markdownParser.parse(source) as Root;
  const slugger = new GithubSlugger();
  const headings: TocHeading[] = [];
  const exercises: { label: string }[] = [];
  const descriptionParts: string[] = [];
  let wordCount = 0;

  visit(tree, "heading", (node: Heading) => {
    const text = toString(node).trim();
    const id = slugger.slug(text);

    if (node.depth <= 3) {
      headings.push({ id, text, level: node.depth });
    }
  });

  visit(tree, "paragraph", (node: Paragraph) => {
    const text = toString(node).trim();
    if (!text) {
      return;
    }

    wordCount += text.split(/\s+/).length;

    if (descriptionParts.length < 2 && !EXERCISE_PATTERN.test(text)) {
      descriptionParts.push(text);
    }

    const match = text.match(EXERCISE_PATTERN);
    if (match) {
      exercises.push({ label: match[1] });
    }
  });

  visit(tree, "code", (node) => {
    wordCount += toString(node).split(/\s+/).length;
  });

  const description = buildDescription(descriptionParts[0] ?? "");

  return {
    headings,
    exercises,
    description,
    wordCount,
  };
}

function buildDescription(text: string): string {
  if (!text) {
    return "";
  }

  if (text.length <= 240) {
    return text;
  }

  const truncated = text.slice(0, 240);
  const lastSpace = truncated.lastIndexOf(" ");
  return `${truncated.slice(0, lastSpace > 120 ? lastSpace : 240).trimEnd()}…`;
}

export function normalizeLinkTarget(url: string): string | null {
  if (
    !url ||
    url.startsWith("#") ||
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("mailto:") ||
    url.startsWith("tel:")
  ) {
    return null;
  }

  const [pathPart] = url.split("#");
  if (!pathPart) {
    return null;
  }

  const normalized = pathPart
    .replace(/^\.\//, "")
    .replace(/^\.\.\//, "")
    .replace(/^\/+/, "");

  return normalized || null;
}

export function rewriteLink(
  url: string,
  linkMap: Record<string, string>,
): string {
  if (!url) {
    return url;
  }

  if (
    url.startsWith("#") ||
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("mailto:") ||
    url.startsWith("tel:")
  ) {
    return url;
  }

  const hashIndex = url.indexOf("#");
  const pathPart = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
  const target = normalizeLinkTarget(pathPart);

  if (!target) {
    return url;
  }

  const mapped = linkMap[target];
  return mapped ? `${mapped}${hash}` : url;
}

export function remarkRewriteLinks(options: {
  linkMap: Record<string, string>;
}) {
  return (tree: Root) => {
    visit(tree, "link", (node: Link) => {
      node.url = rewriteLink(node.url, options.linkMap);
    });
  };
}

export function remarkExerciseIds(options: {
  chapterNumber: number;
  chapterSlug: string;
}) {
  return (tree: Root) => {
    visit(tree, "paragraph", (node: Paragraph) => {
      const text = toString(node).trim();
      const match = text.match(EXERCISE_PATTERN);
      if (!match) {
        return;
      }

      const label = match[1];
      const id = `ch${options.chapterNumber}-${label}`;
      node.data = {
        ...node.data,
        hProperties: {
          ...node.data?.hProperties,
          "data-exercise-id": id,
          "data-exercise-label": label,
          "data-exercise-chapter": options.chapterSlug,
        },
      };
    });
  };
}

export function getSectionDocuments(
  source: string,
  options: {
    route: string;
    chapterSlug: string;
    chapterNumber: number;
    chapterTitle: string;
    maxTextLength?: number;
  },
): {
  heading: string;
  anchor: string;
  text: string;
}[] {
  const tree = markdownParser.parse(source) as Root;
  const slugger = new GithubSlugger();
  const maxTextLength = options.maxTextLength ?? 8000;
  const documents: { heading: string; anchor: string; text: string }[] = [];
  let current: { heading: string; anchor: string; parts: string[] } | null = {
    heading: options.chapterTitle,
    anchor: "",
    parts: [],
  };

  const flush = () => {
    if (!current) {
      return;
    }

    const text = current.parts
      .join("\n")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxTextLength);

    if (text || current.heading) {
      documents.push({
        heading: current.heading,
        anchor: current.anchor,
        text,
      });
    }
  };

  for (const node of tree.children as RootContent[]) {
    if (node.type === "heading") {
      const text = toString(node).trim();
      const id = slugger.slug(text);

      if (node.depth <= 2) {
        flush();
        current = null;

        if (text !== "Contents") {
          current = {
            heading: text,
            anchor: id,
            parts: [],
          };
        }
        continue;
      }
    }

    if (current) {
      current.parts.push(toString(node));
    }
  }

  flush();

  if (documents.length === 0) {
    documents.push({
      heading: options.chapterTitle,
      anchor: "",
      text: toString(tree).replace(/\s+/g, " ").trim().slice(0, maxTextLength),
    });
  }

  return documents;
}
