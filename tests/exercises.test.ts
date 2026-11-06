import { describe, expect, it } from "vitest";
import { extractExercises } from "../lib/exercises";
import { getChapter } from "../lib/content";
import { initialExerciseDraft, interactionFor } from "../lib/chapter-one-exercises";

describe("exercise workspaces", () => {
  it("never borrows a following lesson's fences", () => {
    const exercises = extractExercises('**A1.** Explain this.\n\n## Next lesson\n\n```python\nprint("not A1")\n```\n\n**A2.** Write code.\n', 1, "test");
    expect(exercises).toHaveLength(2);
    expect(exercises[0].fences).toEqual([]);
    expect(exercises[0].source).not.toContain("Next lesson");
  });
  it("provides all 213 Chapter 1 exercises in source order including fence-free tasks", () => {
    const chapter = getChapter("fundamentals")!;
    const exercises = extractExercises(chapter.body, 1, chapter.slug);
    expect(exercises.map((e) => e.id)).toEqual(chapter.exercises.map((e) => e.id));
    expect(exercises).toHaveLength(213);
    expect(exercises.findIndex((e) => e.label === "N1")).toBeLessThan(exercises.findIndex((e) => e.label === "M1"));
    const n1 = exercises.find((e) => e.label === "N1")!;
    expect(n1.fences).toEqual([]);
    expect(initialExerciseDraft(n1).files["main.py"]).toContain("Write your Python");
    expect(interactionFor("N1")).toBe("implement");
    expect(interactionFor("A1")).toBe("predict");
    expect(interactionFor("A4")).toBe("debug");
    expect(interactionFor("A10")).toBe("explain");
    expect(interactionFor("M1")).toBe("translate");
  });
  it("keeps independent examples separate and TypeScript as reference", () => {
    const exercises = extractExercises(getChapter("fundamentals")!.body, 1, "fundamentals");
    expect(Object.keys(initialExerciseDraft(exercises.find((e) => e.label === "A5")!).files)).toHaveLength(3);
    const m1 = exercises.find((e) => e.label === "M1")!;
    expect(m1.source).toContain("const user");
    expect(initialExerciseDraft(m1).files["main.py"]).not.toContain("const user");
    expect(initialExerciseDraft(exercises.find((e) => e.label === "L3")!).files["main.py"]).toContain("count += 1");
  });
});
