import { describe, expect, it } from "vitest";
import { discoverChapterFiles, getChapterMetas } from "../lib/content";
import {
  getSectionDocuments,
  parseMarkdown,
  rewriteLink,
  splitDocumentTitle,
} from "../lib/markdown";

describe("splitDocumentTitle", () => {
  it("extracts the chapter title and leaves the body", () => {
    const result = splitDocumentTitle(
      "# Chapter 3 — Practical Python Development\n\nIntro paragraph.\n",
    );

    expect(result.fullTitle).toBe(
      "Chapter 3 — Practical Python Development",
    );
    expect(result.title).toBe("Practical Python Development");
    expect(result.body).toBe("Intro paragraph.\n");
  });
});

describe("parseMarkdown", () => {
  it("extracts exercise labels, headings, and the description", () => {
    const parsed = parseMarkdown(`## 1. Names

Intro text with enough detail to describe the chapter.

## Group A — Names

**A1.** Predict the output:

\`\`\`python
print("hello")
\`\`\`

**A2.** Explain the result.
`);

    expect(parsed.headings.map((heading) => heading.text)).toEqual([
      "1. Names",
      "Group A — Names",
    ]);
    expect(parsed.exercises.map((exercise) => exercise.label)).toEqual([
      "A1",
      "A2",
    ]);
    expect(parsed.description).toContain("Intro text");
  });

  it("does not treat inline bold text as an exercise", () => {
    const parsed = parseMarkdown(
      "This is **important** but not an exercise.\n",
    );
    expect(parsed.exercises).toHaveLength(0);
  });

  it("keeps the H1 exercises divider in the heading list", () => {
    const parsed = parseMarkdown("# Exercises\n\n**A1.** First task.\n");
    expect(parsed.headings).toEqual([
      { id: "exercises", text: "Exercises", level: 1 },
    ]);
  });
});

describe("rewriteLink", () => {
  const linkMap = {
    "chapter-2/functions-objects.md": "/chapters/functions-objects",
    "README.md": "/",
  };

  it("rewrites relative chapter links and preserves anchors", () => {
    expect(
      rewriteLink(
        "../chapter-2/functions-objects.md#classes",
        linkMap,
      ),
    ).toBe("/chapters/functions-objects#classes");
  });

  it("rewrites the course index link", () => {
    expect(rewriteLink("../README.md", linkMap)).toBe("/");
  });

  it("leaves external and anchor links alone", () => {
    expect(rewriteLink("https://example.com", linkMap)).toBe(
      "https://example.com",
    );
    expect(rewriteLink("#section", linkMap)).toBe("#section");
  });
});

describe("getSectionDocuments", () => {
  it("creates search documents with stable heading anchors", () => {
    const documents = getSectionDocuments(
      `Intro overview.

## First section

Some text.

### Nested detail

More text.

## Second section

Final text.
`,
      {
        route: "/test",
        chapterSlug: "test",
        chapterNumber: 1,
        chapterTitle: "Test chapter",
      },
    );

    expect(documents.map((document) => document.heading)).toEqual([
      "Test chapter",
      "First section",
      "Second section",
    ]);
    expect(documents[1].anchor).toBe("first-section");
    expect(documents[1].text).toContain("Nested detail");
    expect(documents[1].text).toContain("More text");
  });
});

describe("course content", () => {
  it("discovers all 12 chapters with unique exercise IDs", () => {
    const files = discoverChapterFiles();
    expect(files).toHaveLength(12);
    expect(files.map((file) => file.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);

    const chapters = getChapterMetas();
    for (const chapter of chapters) {
      const ids = chapter.exercises.map((exercise) => exercise.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBeGreaterThan(100);
    }
  });
});
