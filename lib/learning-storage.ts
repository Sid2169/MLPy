import { migrateLearningState, type LearningState } from "./learning-state";

const FALLBACK_KEY = "mlpy:learning:v2";
let database: Promise<IDBDatabase> | undefined;

function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("mlpy-learning", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Learning storage is blocked by another tab."));
  });
  return database;
}

async function readDatabase(): Promise<unknown> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readonly");
    const request = tx.objectStore("state").get("current");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadLearningState() {
  let fallback: unknown;
  try { fallback = JSON.parse(localStorage.getItem(FALLBACK_KEY) ?? localStorage.getItem("mlpy:progress:v1") ?? "null"); } catch {}
  try {
    const saved = await readDatabase();
    return { state: migrateLearningState(saved ?? fallback), persistent: true };
  } catch {
    return { state: migrateLearningState(fallback), persistent: false };
  }
}

// Serialize writes so a slower older snapshot cannot overwrite newer work.
let pending = Promise.resolve();
export function saveLearningState(state: LearningState): Promise<"indexeddb" | "fallback"> {
  const write = pending.then(async () => {
    try {
      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("state", "readwrite");
        tx.objectStore("state").put(state, "current");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return "indexeddb" as const;
    } catch {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(state));
      return "fallback" as const;
    }
  });
  pending = write.then(() => {}, () => {});
  return write;
}
