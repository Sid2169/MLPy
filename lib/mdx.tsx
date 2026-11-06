import type { ReactElement } from "react";
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

export type RenderMarkdownOptions = {
  chapter?: ChapterMeta;
  linkMap: Record<string, string>;
  interactiveCode?: boolean;
};

export async function renderMarkdown(
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
