import { describe, expect, it } from "vitest";
import { validWorkspacePath, validateWorkspaceRun, type WorkspaceRun } from "../lib/workspace-runtime";

const base: WorkspaceRun = { files: { "main.py": "print('hello')", "data/input.csv": "x\n1" }, entrypoint: "main.py", stdin: "Ada\n", packages: ["numpy"], mode: "script" };
describe("workspace execution contracts", () => {
  it("accepts relative module and dataset paths", () => {
    expect(validateWorkspaceRun(base)).toBeNull();
    expect(validWorkspacePath("package/__init__.py")).toBe(true);
  });
  it("rejects traversal, nonexistent entrypoints and unsupported package specifications", () => {
    for (const path of ["/etc/passwd", "../secret", "a/../b", "a//b", "a\\b", ""]) expect(validWorkspacePath(path)).toBe(false);
    expect(validateWorkspaceRun({ ...base, entrypoint: "missing.py" })).toContain("entrypoint");
    expect(validateWorkspaceRun({ ...base, packages: ["https://example.org/pkg.whl"] })).toContain("package names");
  });
  it("bounds text payloads, file counts, and stdin", () => {
    expect(validateWorkspaceRun({ ...base, files: { "main.py": "é".repeat(500001) } })).toContain("1 MB");
    expect(validateWorkspaceRun({ ...base, stdin: "x".repeat(100001) })).toContain("input");
    expect(validateWorkspaceRun({ ...base, files: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`${i}.py`, ""])) })).toContain("50");
  });
});
