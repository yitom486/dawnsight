import { migrateLegacyStorage } from "./legacyStorage";

// Side-effect module: `main.tsx` imports it before anything that creates a
// persisted store, so renamed settings are in place when stores hydrate.
try {
  migrateLegacyStorage(window.localStorage);
} catch {
  // Storage unavailable or full: start with defaults rather than fail to boot.
}
