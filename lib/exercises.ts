import { toString } from "mdast-util-to-string";
import type { Root, RootContent } from "mdast";
import { markdownParser } from "./markdown";

export type ExerciseDefinition = {
  id: string;
  label: string;
  chapterSlug: string;
  source: string;
  prompt: string;
  fences: { language: string; code: string }[];
};

// Boundaries deliberately exclude the next lesson, its examples, and headings.
export function extractExercises(source: string, chapterNumber: number, chapterSlug: string): ExerciseDefinition[] {
  const tree = markdownParser.parse(source) as Root;
  const exercises: ExerciseDefinition[] = [];
  let nodes: RootContent[] = [];
  let label = "";
  const flush = () => {
    if (!label || nodes.length === 0) return;
    const start = nodes[0].position?.start.offset ?? 0;
    const end = nodes[nodes.length - 1].position?.end.offset ?? start;
    exercises.push({
      id: `ch${chapterNumber}-${label}`, label, chapterSlug,
      source: source.slice(start, end),
      prompt: toString(nodes[0]),
      fences: nodes.flatMap((node) => node.type === "code" ? [{ language: node.lang ?? "text", code: node.value }] : []),
    });
    nodes = [];
    label = "";
  };
  for (const node of tree.children) {
    const match = node.type === "paragraph" ? toString(node).match(/^([A-Z][A-Z0-9]*[0-9]+)\.\s/) : null;
    if (match) {
      flush();
      label = match[1];
    } else if (node.type === "heading" || node.type === "thematicBreak") {
      flush();
    }
    if (label) nodes.push(node);
  }
  flush();
  return exercises;
}
