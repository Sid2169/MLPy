// Small process-local LRU cache. Share in-flight work and retry failures.
export function createAsyncCache<T>(capacity: number) {
  const entries = new Map<string, Promise<T>>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const existing = entries.get(key);
    if (existing) {
      entries.delete(key);
      entries.set(key, existing);
      return existing;
    }
    const pending = Promise.resolve().then(load).catch((error) => {
      if (entries.get(key) === pending) entries.delete(key);
      throw error;
    });
    entries.set(key, pending);
    if (entries.size > capacity) entries.delete(entries.keys().next().value!);
    return pending;
  };
}
