/**
 * One-time rename of settings saved by the pre-rename app (Lumina, ≤ 0.4.1).
 *
 * The Rust side seeds a fresh WebView profile with the old profile's
 * localStorage before the window opens; this renames the `lumina-*` keys
 * (including suffixed ones such as `lumina-acp-chat-restore:<profile>`) to
 * their `dawnsight-*` names. It must run before any persisted store hydrates,
 * so `main.tsx` imports `legacyStorageBoot` first.
 *
 * Old keys are kept (the old install may still read them) and existing
 * `dawnsight-*` keys are never overwritten.
 */

const LEGACY_PREFIX = "lumina-";
const PREFIX = "dawnsight-";
export const LEGACY_STORAGE_MARKER = "dawnsight-migrated-from-lumina";

export function migrateLegacyStorage(storage: Storage): number {
  if (storage.getItem(LEGACY_STORAGE_MARKER) !== null) return 0;

  const legacyKeys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(LEGACY_PREFIX)) legacyKeys.push(key);
  }

  let migrated = 0;
  for (const key of legacyKeys) {
    const next = PREFIX + key.slice(LEGACY_PREFIX.length);
    const value = storage.getItem(key);
    if (value === null || storage.getItem(next) !== null) continue;
    storage.setItem(next, value);
    migrated += 1;
  }
  storage.setItem(LEGACY_STORAGE_MARKER, String(Date.now()));
  return migrated;
}
