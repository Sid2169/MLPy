import fs from "node:fs";
import path from "node:path";
import type { Link } from "mdast";
import { visit } from "unist-util-visit";
import {
  discoverChapterFiles,
  getChapterLinkMap,
} from "../lib/content";
import {
  markdownParser,
  normalizeLinkTarget,
  parseMarkdown,
  splitDocumentTitle,
} from "../lib/markdown";

type Issue = {
  file: string;
  message: string;
};

const allowedFenceLanguages = new Set([
  "",
  "bash",
  "console",
  "css",
  "csv",
  "diff",
  "dockerfile",
  "go",
  "html",
  "http",
  "ini",
  "java",
  "js",
  "json",
  "jsx",
  "markdown",
  "md",
  "py",
  "python",
  "ruby",
  "sh",
  "shell",
  "sql",
  "text",
  "toml",
  "ts",
  "tsx",
  "typescript",
  "yaml",
]);

function main() {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const chapterFiles = discoverChapterFiles();
  const linkMap = getChapterLinkMap();

  if (chapterFiles.length !== 12) {
    errors.push({
      file: ".",
      message: `Expected 12 chapters, found ${chapterFiles.length}.`,
    });
  }

  const numbers = chapterFiles.map((chapter) => chapter.number);
  for (let expected = 1; expected <= 12; expected += 1) {
    if (!numbers.includes(expected)) {
      errors.push({
        file: ".",
        message: `Missing chapter-${expected} directory or Markdown file.`,
      });
    }
  }

  const slugs = new Set<string>();
  for (const chapter of chapterFiles) {
    if (slugs.has(chapter.slug)) {
      errors.push({
        file: chapter.filePath,
        message: `Duplicate chapter slug "${chapter.slug}".`,
      });
    }
    slugs.add(chapter.slug);

    const source = fs.readFileSync(chapter.absolutePath, "utf8");
    const firstLine = source.split(/\r?\n/).find((line) => line.trim()) ?? "";

    if (!/^#\s+Chapter\s+\d+\s+—\s+/.test(firstLine)) {
      errors.push({
        file: chapter.filePath,
        message: `Expected an H1 like "# Chapter N — Title", found "${firstLine.slice(0, 80)}".`,
      });
    }

    const { body } = splitDocumentTitle(source);
    const parsed = parseMarkdown(body);
    const labels = parsed.exercises.map((exercise) => exercise.label);
    const uniqueLabels = new Set(labels);

    if (labels.length === 0) {
      errors.push({
        file: chapter.filePath,
        message: "No exercises detected.",
      });
    }

    if (uniqueLabels.size !== labels.length) {
      errors.push({
        file: chapter.filePath,
        message: "Exercise labels are not unique within the chapter.",
      });
    }

    const fenceLanguages = collectFenceLanguages(source);
    for (const language of fenceLanguages) {
      if (!allowedFenceLanguages.has(language)) {
        errors.push({
          file: chapter.filePath,
          message: `Unsupported code fence language "${language || "(none)"}".`,
        });
      }
    }

    const tree = markdownParser.parse(body);
    visit(tree, "link", (node: Link) => {
      const target = normalizeLinkTarget(node.url);
      if (target && target.endsWith(".md") && !linkMap[target]) {
        errors.push({
          file: chapter.filePath,
          message: `Unresolved internal link "${node.url}".`,
        });
      }
    });

    visit(tree, "paragraph", (node) => {
      const text = getText(node).trim();
      if (!text.startsWith("**")) {
        return;
      }

      const boldMatch = text.match(/^\*\*([^*]+)\*\*/);
      if (!boldMatch) {
        return;
      }

      const candidate = boldMatch[1].trim();
      if (!/^[A-Z][A-Z0-9]*[0-9]+\.?$/.test(candidate)) {
        warnings.push({
          file: chapter.filePath,
          message: `Bold paragraph starts with "${candidate}", which is not an exercise marker.`,
        });
      }
    });
  }

  for (const fileName of [
    "README.md",
    "Curriculum.md",
    "Chapter-generation.md",
  ]) {
    if (!fs.existsSync(path.join(process.cwd(), fileName))) {
      errors.push({ file: fileName, message: "Reference document is missing." });
    }
  }

  for (const warning of warnings) {
    console.warn(`warning ${warning.file}: ${warning.message}`);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`error ${error.file}: ${error.message}`);
    }
    console.error(`\nContent validation failed with ${errors.length} error(s).`);
    process.exit(1);
  }

  console.log(
    `Content validation passed: ${chapterFiles.length} chapters, ${chapterFiles.reduce(
      (total, chapter) => {
        const source = fs.readFileSync(chapter.absolutePath, "utf8");
        const { body } = splitDocumentTitle(source);
        return total + parseMarkdown(body).exercises.length;
      },
      0,
    )} exercises.`,
  );
}

function collectFenceLanguages(source: string): string[] {
  const languages = new Set<string>();

  for (const line of source.split(/\r?\n/)) {
    if (!line.startsWith("```")) {
      continue;
    }

    const language = line.slice(3).trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    languages.add(language);
  }

  return [...languages];
}

function getText(node: { children?: unknown[]; value?: string }): string {
  if (node.value) {
    return node.value;
  }

  return (node.children ?? [])
    .map((child) => getText(child as { children?: unknown[]; value?: string }))
    .join("");
}

main();
