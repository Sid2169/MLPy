export type WorkspaceArtifact =
  | { kind: "table"; columns: string[]; rows: string[][]; truncated: boolean }
  | { kind: "plot"; png: string };

export type WorkspaceRun = {
  files: Record<string, string>;
  entrypoint: string;
  stdin: string;
  packages: string[];
  mode: "script" | "notebook" | "module";
};

export function validWorkspacePath(path: string): boolean {
  return path.length > 0 && path.length < 200 && !path.startsWith("/") &&
    /^[a-zA-Z0-9_./-]+$/.test(path) &&
    path.split("/").every((part) => part !== ".." && part !== "." && part !== "");
}

export function validateWorkspaceRun(run: WorkspaceRun): string | null {
  const entries = Object.entries(run.files);
  if (!entries.length || entries.length > 50) return "Use between 1 and 50 text files.";
  if (entries.some(([path]) => !validWorkspacePath(path))) return "Use relative file paths without .., spaces, or leading slashes.";
  if (!run.entrypoint.endsWith(".py") || !(run.entrypoint in run.files)) return "Choose an existing .py entrypoint.";
  if (entries.reduce((size, [, content]) => size + new TextEncoder().encode(content).length, 0) > 1_000_000) return "Workspace text files must total less than 1 MB.";
  if (run.stdin.length > 100_000) return "Standard input is limited to 100,000 characters.";
  if (run.packages.length > 15 || run.packages.some((name) => !/^[a-zA-Z0-9_-]+$/.test(name))) return "Enter up to 15 Pyodide package names, separated by commas.";
  return null;
}
