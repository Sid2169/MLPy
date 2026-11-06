import { describe, expect, it } from "vitest";
import { getChapterMetas, getChapterExercises } from "../lib/content";
import { extractExercises } from "../lib/exercises";
import { initialExerciseDraft, interactionFor, profileFor, languageForFile, workspaceHref } from "../lib/exercise-workspaces";
import { validWorkspacePath } from "../lib/workspace-runtime";

describe("full-course exercise workspaces", () => {
  it("covers all 2,612 exercises in all 12 chapters without changing source order or IDs", () => {
    const chapters = getChapterMetas();
    const routes = new Set<string>();
    let count = 0;
    for (const chapter of chapters) {
      const exercises = getChapterExercises(chapter.slug);
      expect(exercises.map((e) => e.id), chapter.slug).toEqual(chapter.exercises.map((e) => e.id));
      for (const exercise of exercises) {
        expect(exercise.chapterNumber).toBe(chapter.number);
        expect(exercise.source).toContain(`**${exercise.label}.**`);
        const draft = initialExerciseDraft(exercise);
        expect(Object.hasOwn(draft.files, draft.activeFile)).toBe(true);
        expect(Object.hasOwn(draft.files, draft.entrypoint)).toBe(true);
        expect(draft.entrypoint.endsWith(".py")).toBe(true);
        expect(Object.keys(draft.files).every(validWorkspacePath)).toBe(true);
        expect(profileFor(exercise).guidance.length).toBeGreaterThan(0);
        routes.add(workspaceHref(chapter.slug, exercise.id));
        count++;
      }
    }
    expect(chapters).toHaveLength(12);
    expect(count).toBe(2612);
    expect(routes.size).toBe(count);
  }, 15000);

  it("preserves named multi-file examples and does not leak Chapter 1's L3 starter", () => {
    const a1 = getChapterExercises("functions-objects").find((e) => e.label === "A1")!;
    const draft = initialExerciseDraft(a1);
    expect(interactionFor(a1)).toBe("predict");
    expect(Object.keys(draft.files)).toEqual(["util.py", "main.py"]);
    expect(draft.files["util.py"]).toContain('print("A")');
    expect(draft.files["main.py"]).toContain("import util");
    expect(draft.entrypoint).toBe("main.py");
    for (const exercise of getChapterExercises("practical-dev").filter((e) => e.label === "L3")) {
      expect(initialExerciseDraft(exercise).files["main.py"]).not.toContain("count += 1");
    }
    expect(initialExerciseDraft(getChapterExercises("fundamentals").find((e) => e.label === "L3")!).files["main.py"]).toContain("count += 1");
  });

  it("keeps commands/configuration as their own file types, not Python code", () => {
    const a1 = getChapterExercises("practical-dev").find((e) => e.label === "A1")!;
    expect(interactionFor(a1)).toBe("commands");
    const draft = initialExerciseDraft(a1);
    expect(draft.activeFile).toBe("commands.sh");
    expect(languageForFile(draft.activeFile)).toBe("bash");
    const a9 = getChapterExercises("practical-dev").find((e) => e.label === "A9")!;
    expect(interactionFor(a9)).toBe("configure");
    expect(initialExerciseDraft(a9).activeFile).toBe("pyproject.toml");
    expect(languageForFile("Dockerfile")).toBe("dockerfile");
    const docker = getChapterExercises("deployment-observability").find((e) => e.label === "J21")!;
    expect(interactionFor(docker)).toBe("configure");
    expect(initialExerciseDraft(docker).files).toHaveProperty("Dockerfile");
    expect(profileFor(docker).environment).toBe("local");
  });

  it("extracts nested fences, retains conflicting variants, and never imports neighboring lessons", () => {
    const [exercise] = extractExercises('**A1.** Implement these files.\n\n- First file:\n\n  ```python title="pkg/main.py"\n  print("first")\n  ```\n\n```python\n# pkg/main.py\nprint("variant")\n```\n\n## Next lesson\n\n```python\nprint("not starter")\n```', 2, "test");
    expect(exercise.fences).toHaveLength(2);
    const draft = initialExerciseDraft(exercise);
    expect(draft.files["pkg/main.py"]).toContain("first");
    expect(draft.files["variant_2/pkg/main.py"]).toContain("variant");
    expect(Object.values(draft.files).join("\n")).not.toContain("not starter");
  });

  it("labels native and infrastructure tasks honestly and keeps data prerequisites explicit", () => {
    expect(profileFor(getChapterExercises("dl-pytorch")[0]).environment).toBe("local");
    expect(profileFor(getChapterExercises("practical-dev").find((e) => e.label === "A2")!).environment).toBe("local");
    const data = getChapterExercises("data-processing").find((e) => e.source.includes("books.csv"))!;
    expect(profileFor(data).notes.join(" ")).toContain("not bundled");
    const native = getChapterExercises("deployment-observability").find((e) => e.label === "D24")!;
    expect(profileFor(native).environment).toBe("local");
  });
});
