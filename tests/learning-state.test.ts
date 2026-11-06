import { describe, expect, it } from "vitest";
import { emptyLearningState, migrateLearningState } from "../lib/learning-state";

describe("learning storage migration", () => {
  it("preserves legacy completion and notes, removing duplicate and invalid IDs", () => {
    const migrated = migrateLearningState({ version: 1, completed: { fundamentals: ["ch1-A1", "ch1-A1", 12] }, notes: { "fundamentals:ch1-A1": "Keep this" } });
    expect(migrated.completed.fundamentals).toEqual(["ch1-A1"]);
    expect(migrated.notes["fundamentals:ch1-A1"]).toBe("Keep this");
    expect(migrated.drafts).toEqual({});
  });
  it("round trips multi-file drafts, written answers, and resume position", () => {
    const state = emptyLearningState();
    state.drafts["exercise:fundamentals:ch1-A1"] = { files: { "main.py": "print('hi')", "data.txt": "hello" }, activeFile: "main.py", entrypoint: "main.py", answer: "My prediction", stdin: "hello\n", updatedAt: 10 };
    state.lastVisited = { chapterSlug: "fundamentals", exerciseId: "ch1-A1", label: "A1" };
    expect(migrateLearningState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });
  it("recovers from unknown versions and invalid storage", () => {
    for (const value of [null, "bad", { version: 99 }, { version: 1, completed: { x: "invalid" }, notes: 5 }]) {
      expect(migrateLearningState(value)).toEqual(emptyLearningState());
    }
  });
});
