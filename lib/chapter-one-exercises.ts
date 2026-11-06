import type { ExerciseDefinition } from "./exercises";
import type { WorkspaceDraft } from "./learning-state";

export type Interaction = "predict" | "implement" | "debug" | "explain" | "translate";

// Authored interaction overrides. Predictions are the default recognition task;
// implementation, debugging, conceptual, and translation tasks are explicit.
const labels = (text: string) => new Set(text.split(/\s+/));
const implementation = labels("A11 A13 B11 B12 B15 C2 C5 C10 C13 C17 C18 D6 D9 E10 E11 E14 E17 F7 F9 F11 F12 G3 G8 G10 G11 G16 G17 H8 H9 H10 H12 I11 I13 I14 I15 I19 J4 J9 J10 J13 J15 J16 J17 K9 K14 K15 K18 K20 L4 L11");
const debugging = labels("A4 A15 C6 D5 E13 H4 I17 J12 K2 K13 L3 L7 L8");
const explanation = labels("A5 A8 A10 A12 B2 B8 C3 D1 F1 F5 F6 F10 G7 H1 H3 H5 H6 K4 K5 K7 L12");

export function interactionFor(label: string): Interaction {
  if (label.startsWith("M") || label === "K17") return "translate";
  if (label.startsWith("N") || implementation.has(label)) return "implement";
  if (debugging.has(label)) return "debug";
  if (explanation.has(label)) return "explain";
  return "predict";
}

export const interactionGuidance: Record<Interaction, string> = {
  predict: "Record your prediction before running. Compare the observed result with your reasoning; an exception may be the expected outcome.",
  implement: "Implement your own solution and add example calls or assertions. The prompt's expected values are examples, not automated checks.",
  debug: "Explain the cause first, then edit the provided code or write a corrected version. Keep your reasoning in the written answer.",
  explain: "Write your reasoning. Use the optional Python scratchpad to investigate; execution alone cannot assess an explanation.",
  translate: "Keep the TypeScript in the reference prompt. Write the equivalent Python in main.py and explain any semantic differences.",
};

export function initialExerciseDraft(exercise: ExerciseDefinition): WorkspaceDraft {
  const python = exercise.fences.filter((fence) => ["python", "py", "python3"].includes(fence.language));
  const files: Record<string, string> = {};
  if (python.length) {
    python.forEach((fence, index) => {
      files[index === 0 ? "main.py" : `example_${index + 1}.py`] = fence.code;
    });
  } else {
    files["main.py"] = "# Write your Python here. Add print() calls or assertions to inspect results.\n";
  }
  // This task explicitly refers back to L2; provide only its buggy given code.
  if (exercise.label === "L3") files["main.py"] = "count = 0\n\ndef inc():\n    count += 1\n\ninc()\n";
  return { files, activeFile: "main.py", entrypoint: "main.py", answer: "", stdin: "", sourceRevision: exercise.source, updatedAt: 0 };
}
