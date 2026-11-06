import { toString } from "mdast-util-to-string";
import type { Root, RootContent } from "mdast";
import { markdownParser } from "./markdown";
import { visit } from "unist-util-visit";
import { validWorkspacePath } from "./workspace-runtime";

export type ExerciseDefinition = {
  id: string;
  label: string;
  chapterSlug: string;
  chapterNumber: number;
  group: string;
  source: string;
  prompt: string;
  fences: { language: string; code: string; fileName?: string }[];
};

// Boundaries deliberately exclude the next lesson, its examples, and headings.
export function extractExercises(source: string, chapterNumber: number, chapterSlug: string): ExerciseDefinition[] {
  const tree = markdownParser.parse(source) as Root;
  const exercises: ExerciseDefinition[] = [];
  let nodes: RootContent[] = [];
  let label = "";
  let group = "";
  const flush = () => {
    if (!label || nodes.length === 0) return;
    const start = nodes[0].position?.start.offset ?? 0;
    const end = nodes[nodes.length - 1].position?.end.offset ?? start;
    const fences: ExerciseDefinition["fences"] = [];
    visit({ type: "root", children: nodes } as Root, "code", (node) => {
      const metaName = node.meta?.match(/(?:title|file|filename)=["']?([\w./-]+)/)?.[1];
      const commentName = node.value.split("\n")[0].match(/^\s*#\s*(?:file:\s*)?([\w./-]+\.(?:py|json|csv|toml|yaml|yml|sql|txt|ini))\s*$/i)?.[1];
      const candidate = metaName ?? commentName;
      fences.push({ language: node.lang ?? "text", code: node.value,
        ...(candidate && validWorkspacePath(candidate) ? { fileName: candidate } : {}),
      });
    });
    exercises.push({
      id: `ch${chapterNumber}-${label}`, label, chapterSlug, chapterNumber, group,
      source: source.slice(start, end),
      prompt: toString(nodes[0]),
      fences,
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
      if (node.type === "heading" && /^Group\s/.test(toString(node))) group = toString(node);
    }
    if (label) nodes.push(node);
  }
  flush();
  return exercises;
}
