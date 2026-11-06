import type { ExerciseDefinition } from "./exercises";
import type { WorkspaceDraft } from "./learning-state";
import {
  initialExerciseDraft as chapterOneDraft,
  interactionFor as chapterOneInteraction,
  interactionGuidance as chapterOneGuidance,
  type Interaction as ChapterOneInteraction,
} from "./chapter-one-exercises";
import { validWorkspacePath } from "./workspace-runtime";

export type Interaction = ChapterOneInteraction | "commands" | "configure";
export const interactionGuidance: Record<Interaction, string> = {
  ...chapterOneGuidance,
  commands: "Write the commands and explain what each does. Shell commands are text here: run them in a local terminal, not the Python scratchpad.",
  configure: "Edit configuration or SQL in its own file, and explain the choices in your written answer. Run it with the appropriate local tool; Run Python only executes a .py entrypoint.",
};
export const interactions = Object.keys(interactionGuidance) as Interaction[];

export function interactionFor(exercise: ExerciseDefinition): Interaction {
  if (exercise.chapterNumber === 1) return chapterOneInteraction(exercise.label);
  const prompt = exercise.prompt.replace(/^[A-Z][A-Z0-9]*\d+\.\s*/, "");
  if (/\btranslat(?:e|ing)\b/i.test(prompt)) return "translate";
  if (/\b(?:write|give|list|run|sequence|order|activation|uv equivalents)\b.*\bcommands?\b/i.test(prompt)) return "commands";
  if (/\b(?:write|create|add|implement|modify|fix)\b.*(?:Dockerfile|pyproject\.toml|docker-compose|\.ya?ml|SQL query|SQL statement)/i.test(prompt)) return "configure";
  if (/\b(?:fix|debug|diagnose|repair|identify (?:every|all|the) (?:bug|error))\b/i.test(prompt)) return "debug";
  if (/\b(?:predict|trace)\b/i.test(prompt)) return "predict";
  if (/\b(?:write|implement|build|create|rewrite|refactor|replace|deduplicate|complete|design a function)\b/i.test(prompt)) return "implement";
  return "explain";
}

export type WorkspaceProfile = {
  environment: "browser" | "setup" | "local" | "external";
  label: string;
  guidance: string;
  notes: string[];
};

export function profileFor(exercise: ExerciseDefinition): WorkspaceProfile {
  const text = exercise.source;
  const python = exercise.fences.filter((f) => /^(python|py|python3)$/.test(f.language)).map((f) => f.code).join("\n");
  const notes: string[] = [];
  if (/\b(?:np|pd|plt)\./.test(python)) {
    notes.push("Some lesson examples use np, pd, or plt aliases. Include the corresponding numpy, pandas, or matplotlib.pyplot imports in your solution when needed; provided code is kept unchanged.");
  }
  if (/\b[\w./-]+\.(?:csv|jsonl|parquet|xlsx|npz|pth|pt)\b/i.test(text)) {
    notes.push("The prompt references data/model files. They are not bundled unless supplied as starter text; create or upload the required fixtures, or use your local environment for binary/large assets.");
  }
  if (/\b(?:previous|preceding|earlier) (?:exercise|example|function|code)|\bfrom (?:the )?(?:previous|earlier)\b/i.test(text)) {
    notes.push("This task refers to earlier work. Copy the relevant definitions/files into this workspace; runtime state is not shared between exercises.");
  }
  if (/\basyncio\.run\s*\(/.test(text) || exercise.chapterNumber === 6) {
    notes.push("Browser Python already has an event loop. Use notebook mode with top-level await to explore coroutines; use local Python when the task specifically tests asyncio.run(), threads, or process behavior.");
  }
  if (exercise.chapterNumber === 9 || /\b(?:torch|cuda|ProcessPoolExecutor|multiprocessing|subprocess|threading|SIGTERM|SIGKILL|os\.fork|uvicorn|gunicorn)\b/i.test(text) ||
      /\b(?:docker(?:file)?|kubectl|virtual environments?|venv|pip install|uv pip|uv venv)\b/i.test(text)) {
    return { environment: "local", label: "Local runtime task · browser scratchpad available", guidance: "Use your local Python/terminal for the task's native packages, processes, serving, or deployment steps. You can save the full solution here and run independent browser-compatible Python experiments below.", notes };
  }
  if (/\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|AsyncOpenAI)\b|\b(?:OpenAI|Anthropic)\s*\(|api\.openai\.com|\breal (?:provider|model|API|network) calls?\b/i.test(text)) {
    return { environment: "external", label: "External-service task · offline scratchpad available", guidance: "Use deterministic fakes or mocked responses for browser experiments. Real provider/service calls require an appropriately configured environment and may be blocked by browser networking restrictions. No credentials or hosted services are supplied.", notes };
  }
  if ([3, 4, 5, 7, 8, 10, 11, 12].includes(exercise.chapterNumber) || /^(?:from|import) (?!math\b|json\b|copy\b)/m.test(python)) {
    return { environment: "setup", label: "Browser scratchpad · check exercise prerequisites", guidance: "Browser-compatible Python can run here with available Pyodide packages. Supply the imports, files, mocks, and definitions required by this exercise. API serving, native tools, and unsupported packages need a local environment; compatibility is not guaranteed for every example.", notes };
  }
  return { environment: "browser", label: "Browser Python", guidance: "Use a fresh Python runtime on each attempt. Add print() calls or assertions to investigate; completion remains self-assessed.", notes };
}

const extensions: Record<string, string> = {
  python: "py", py: "py", python3: "py", bash: "sh", sh: "sh", shell: "sh",
  json: "json", sql: "sql", toml: "toml", yaml: "yaml", yml: "yaml", dockerfile: "dockerfile",
};

export function languageForFile(file: string) {
  if (file.split("/").pop() === "Dockerfile") return "dockerfile";
  const extension = file.split(".").pop()?.toLowerCase() ?? "";
  return ({ py: "python", sh: "bash", json: "json", sql: "sql", toml: "toml", yaml: "yaml", yml: "yaml", ts: "typescript", dockerfile: "dockerfile" } as Record<string, string>)[extension] ?? "text";
}

export function initialExerciseDraft(exercise: ExerciseDefinition): WorkspaceDraft {
  // Preserve the pilot's filenames and starter semantics for existing drafts.
  if (exercise.chapterNumber === 1) return chapterOneDraft(exercise);
  const files: Record<string, string> = {};
  const reserved = new Set(exercise.fences.map((f) => f.fileName).filter(Boolean));
  let unnamed = 0;
  for (const fence of exercise.fences) {
    const extension = extensions[fence.language];
    if (!extension && !fence.fileName) continue; // Prose/output/TypeScript stay reference material.
    let name = fence.fileName;
    if (!name) {
      if (extension === "py") {
        name = unnamed++ === 0 && !reserved.has("main.py") ? "main.py" : `example_${unnamed}.py`;
      } else {
        name = ({ sh: "commands.sh", toml: "pyproject.toml", dockerfile: "Dockerfile", sql: "query.sql", yaml: "config.yaml", json: "example.json" } as Record<string, string>)[extension] ?? `example.${extension}`;
      }
    }
    if (!validWorkspacePath(name)) continue;
    if (Object.hasOwn(files, name)) {
      // Conflicting examples are independent variants, never silently overwrite.
      let i = 2;
      const original = name;
      while (Object.hasOwn(files, name)) name = `variant_${i++}/${original}`;
    }
    files[name] = fence.code;
  }
  const interaction = interactionFor(exercise);
  if (interaction === "commands" && !Object.keys(files).some((name) => name.endsWith(".sh"))) files["commands.sh"] = "# Write commands here; execute them in your local terminal.\n";
  if (interaction === "configure") {
    if (/Dockerfile/i.test(exercise.prompt) && !files.Dockerfile) files.Dockerfile = "# Write your Dockerfile here.\n";
    if (/pyproject\.toml/.test(exercise.prompt) && !files["pyproject.toml"]) files["pyproject.toml"] = "# Write your project configuration here.\n";
  }
  const pythonFiles = Object.keys(files).filter((name) => name.endsWith(".py"));
  if (!pythonFiles.length) files["main.py"] = "# Python scratchpad. Write your solution or independent experiments here.\n";
  const entrypoint = pythonFiles.includes("main.py") ? "main.py" : pythonFiles[0] ?? "main.py";
  const preferred = interaction === "commands" ? Object.keys(files).find((name) => name.endsWith(".sh")) : interaction === "configure" ? Object.keys(files).find((name) => !name.endsWith(".py")) : null;
  return { files, activeFile: preferred ?? entrypoint, entrypoint, answer: "", stdin: "", packages: [], mode: "script", sourceRevision: exercise.source, updatedAt: 0 };
}

export const workspaceHref = (slug: string, id: string) => `/practice/${slug}/${id}`;
