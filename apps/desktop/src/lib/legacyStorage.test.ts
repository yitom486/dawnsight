import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it } from "vitest";

import { LEGACY_STORAGE_MARKER, migrateLegacyStorage } from "./legacyStorage";

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

describe("migrateLegacyStorage", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("renames every lumina-* key, including suffixed ones, and keeps the originals", () => {
    storage.setItem("lumina-acp-profiles", '{"state":{"active":"codex"}}');
    storage.setItem("lumina-acp-chat-restore:codex", '{"turns":[]}');
    storage.setItem("lumina-playback-progress", '{"state":{}}');
    storage.setItem("unrelated", "1");

    expect(migrateLegacyStorage(storage)).toBe(3);

    expect(storage.getItem("dawnsight-acp-profiles")).toBe('{"state":{"active":"codex"}}');
    expect(storage.getItem("dawnsight-acp-chat-restore:codex")).toBe('{"turns":[]}');
    expect(storage.getItem("dawnsight-playback-progress")).toBe('{"state":{}}');
    expect(storage.getItem("lumina-acp-profiles")).not.toBeNull();
    expect(storage.getItem("dawnsight-unrelated")).toBeNull();
  });

  it("never overwrites an existing dawnsight-* value", () => {
    storage.setItem("lumina-track-prefs", "old");
    storage.setItem("dawnsight-track-prefs", "new");

    expect(migrateLegacyStorage(storage)).toBe(0);
    expect(storage.getItem("dawnsight-track-prefs")).toBe("new");
  });

  it("runs only once", () => {
    storage.setItem("lumina-session", "first");
    expect(migrateLegacyStorage(storage)).toBe(1);
    expect(storage.getItem(LEGACY_STORAGE_MARKER)).not.toBeNull();

    storage.removeItem("dawnsight-session");
    storage.setItem("lumina-session", "edited in old app");
    expect(migrateLegacyStorage(storage)).toBe(0);
    expect(storage.getItem("dawnsight-session")).toBeNull();
  });

  it("marks a fresh install without legacy data as done", () => {
    expect(migrateLegacyStorage(storage)).toBe(0);
    expect(storage.getItem(LEGACY_STORAGE_MARKER)).not.toBeNull();
  });

  it("is the first import in main.tsx, ahead of any persisted store", () => {
    const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
    const firstImport = main.split(/\r?\n/).find((line) => line.startsWith("import "));
    expect(firstImport).toBe('import "./lib/legacyStorageBoot";');
  });
});
