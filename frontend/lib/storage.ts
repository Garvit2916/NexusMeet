const memoryStore = new Map<string, string>();

export const storageKeys = {
  meetings: "nexusmeet.meetings",
  currentUser: "nexusmeet.current-user",
} as const;

export function readStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    try {
      const value = memoryStore.get(key);
      return value ? (JSON.parse(value) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage<T>(key: string, value: T) {
  const serialized = JSON.stringify(value);
  memoryStore.set(key, serialized);

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(key, serialized);
    } catch {
      return;
    }
  }
}
