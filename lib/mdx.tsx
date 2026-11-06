import type { ReactElement } from "react";
import { createHash } from "node:crypto";
import type { Root } from "hast";
import { visit } from "unist-util-visit";
import { compileMDX } from "next-mdx-remote/rsc";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import type { PluggableList } from "unified";
import { createMdxComponents } from "@/components/mdx-components";
import {
  remarkExerciseIds,
  remarkRewriteLinks,
} from "@/lib/markdown";
import type { ChapterMeta } from "@/lib/types";
import { createAsyncCache } from "@/lib/async-cache";

const compiledMarkdown = createAsyncCache<ReactElement>(24);

// IDs belong to the compiled document, not a mutable render-time counter.
// This keeps saved snippet drafts stable when a cached tree renders again.
function rehypeSnippetIds() {
  return (tree: Root) => {
    let index = 0;
    visit(tree, "element", (node) => {
      if (node.tagName === "pre") node.properties["data-snippet-id"] = String(index++);
    });
  };
}

export type RenderMarkdownOptions = {
  chapter?: ChapterMeta;
  linkMap: Record<string, string>;
  interactiveCode?: boolean;
};

export async function renderMarkdown(
  source: string,
  options: RenderMarkdownOptions,
): Promise<ReactElement> {
  const key = createHash("sha256").update(JSON.stringify({
    source,
    chapter: options.chapter ? [options.chapter.number, options.chapter.slug] : null,
    linkMap: options.linkMap,
    interactiveCode: options.interactiveCode ?? true,
  })).digest("hex");
  return compiledMarkdown(key, () => compileMarkdown(source, options));
}

async function compileMarkdown(
  source: string,
  options: RenderMarkdownOptions,
): Promise<ReactElement> {
  const remarkPlugins: PluggableList = [
    remarkGfm,
    [remarkRewriteLinks, { linkMap: options.linkMap }],
  ];

  if (options.chapter) {
    remarkPlugins.push([
      remarkExerciseIds,
      {
        chapterNumber: options.chapter.number,
        chapterSlug: options.chapter.slug,
      },
    ]);
  }

  const rehypePlugins: PluggableList = [
    rehypeSlug,
    [
      rehypeAutolinkHeadings,
      {
        behavior: "append",
        properties: {
          className: ["heading-anchor"],
          ariaLabel: "Link to this section",
        },
        content: {
          type: "element",
          tagName: "span",
          properties: { className: ["heading-anchor-icon"], ariaHidden: "true" },
          children: [{ type: "text", value: "#" }],
        },
      },
    ],
    [
      rehypePrettyCode,
      {
        theme: {
          light: "github-light",
          dark: "github-dark",
        },
        keepBackground: false,
        bypassInlineCode: true,
        defaultLang: "text",
      },
    ],
    rehypeSnippetIds,
  ];

  const { content } = await compileMDX({
    source,
    components: createMdxComponents({
      chapter: options.chapter,
      interactiveCode: options.interactiveCode,
    }),
    options: {
      parseFrontmatter: false,
      mdxOptions: {
        remarkPlugins,
        rehypePlugins,
      },
    },
  });

  return content;
}
