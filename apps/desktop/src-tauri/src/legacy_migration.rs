//! One-time forward-copy of data left by the pre-rename app (Lumina, ≤ 0.4.1).
//!
//! Runs at the very start of `run()`, before any store is opened and before
//! the WebView is created (config windows are built ahead of `setup`, so the
//! WebView profile must be in place earlier still). User data is copied, never
//! moved, so the old install keeps working; only the large re-downloadable
//! tool folders (whisper models, yt-dlp) are moved to avoid doubling disk use.
//! Nothing is overwritten. Failures are logged and retried on the next start:
//! the marker is written only after a clean run.

use std::fs;
use std::io;
use std::path::Path;

use dawnsight_library::legacy::copy_dir_all;

const LEGACY_DATA_DIR: &str = "lumina";
const DATA_DIR: &str = "dawnsight";
const MARKER_FILE: &str = ".migrated-from-lumina";

const LEGACY_DATABASE: &str = "lumina.sqlite3";
const DATABASE: &str = "dawnsight.sqlite3";
/// SQLite companions that must travel with the main database file.
const DATABASE_SUFFIXES: [&str; 3] = ["", "-wal", "-shm"];

/// Plain user data, copied when the destination is missing.
const COPIED_FILES: [&str; 1] = ["notes.json"];
const COPIED_DIRS: [&str; 2] = ["note-frames", "chapter-assets"];
/// Re-downloadable tool folders, moved rather than copied.
const MOVED_DIRS: [&str; 2] = ["whisper", "yt-dlp"];

#[cfg(windows)]
const LEGACY_WEBVIEW_PROFILE: &str = "com.lumina.desktop";
#[cfg(windows)]
const WEBVIEW_PROFILE: &str = "com.dawnsight.desktop";

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Outcome {
    NothingToMigrate,
    AlreadyMigrated,
    Migrated,
    /// Some items failed; no marker was written so the next start retries.
    Partial,
}

pub(crate) fn migrate_from_lumina() {
    if let Some(base) = crate::commands::system::data_dir() {
        let outcome = migrate_app_data(&base.join(LEGACY_DATA_DIR), &base.join(DATA_DIR));
        tracing::info!(?outcome, "legacy app data migration");
    }
    #[cfg(windows)]
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from) {
        let profile = |name: &str| local.join(name).join("EBWebView").join("Default");
        let outcome =
            migrate_webview_storage(&profile(LEGACY_WEBVIEW_PROFILE), &profile(WEBVIEW_PROFILE));
        tracing::info!(?outcome, "legacy webview storage migration");
    }
}

pub(crate) fn migrate_app_data(legacy: &Path, current: &Path) -> Outcome {
    if !legacy.is_dir() {
        return Outcome::NothingToMigrate;
    }
    let marker = current.join(MARKER_FILE);
    if marker.exists() {
        return Outcome::AlreadyMigrated;
    }
    if let Err(error) = fs::create_dir_all(current) {
        tracing::warn!(%error, "create data dir for legacy migration failed");
        return Outcome::Partial;
    }

    let mut clean = true;
    let mut record = |item: &str, result: io::Result<()>| {
        if let Err(error) = result {
            tracing::warn!(item, %error, "legacy data item migration failed");
            clean = false;
        }
    };

    record("database", copy_database(legacy, current));
    for name in COPIED_FILES {
        record(
            name,
            copy_file_if_missing(&legacy.join(name), &current.join(name)),
        );
    }
    for name in COPIED_DIRS {
        let from = legacy.join(name);
        if from.is_dir() {
            record(name, copy_dir_all(&from, &current.join(name)).map(|_| ()));
        }
    }
    for name in MOVED_DIRS {
        record(
            name,
            move_dir_if_missing(&legacy.join(name), &current.join(name)),
        );
    }

    if !clean {
        return Outcome::Partial;
    }
    let stamp = format!("{{\"from\":\"lumina\",\"atMs\":{}}}\n", now_ms());
    match fs::write(&marker, stamp) {
        Ok(()) => Outcome::Migrated,
        Err(error) => {
            tracing::warn!(%error, "write legacy migration marker failed");
            Outcome::Partial
        }
    }
}

/// Copy the old database only into a fresh install. If a Dawnsight database
/// already exists it may hold newer data; keep it and say so in the log.
fn copy_database(legacy: &Path, current: &Path) -> io::Result<()> {
    let from = legacy.join(LEGACY_DATABASE);
    if !from.is_file() {
        return Ok(());
    }
    if current.join(DATABASE).exists() {
        tracing::warn!("dawnsight database already exists; legacy database left in place");
        return Ok(());
    }
    // Companions first: the main file appearing is what marks the copy done.
    for suffix in DATABASE_SUFFIXES.iter().rev() {
        let companion = legacy.join(format!("{LEGACY_DATABASE}{suffix}"));
        if companion.is_file() {
            fs::copy(&companion, current.join(format!("{DATABASE}{suffix}")))?;
        }
    }
    Ok(())
}

fn copy_file_if_missing(from: &Path, to: &Path) -> io::Result<()> {
    if from.is_file() && !to.exists() {
        fs::copy(from, to)?;
    }
    Ok(())
}

fn move_dir_if_missing(from: &Path, to: &Path) -> io::Result<()> {
    if !from.is_dir() || to.exists() {
        return Ok(());
    }
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        // Different volume or a locked file: fall back to copying.
        Err(_) => copy_dir_all(from, to).map(|_| ()),
    }
}

/// Seed a brand-new WebView profile with the old profile's localStorage.
/// The frontend then renames the `lumina-*` keys (see `legacyStorage.ts`).
/// An existing `Local Storage` folder means the profile is already in use,
/// so it is left alone.
#[cfg(windows)]
pub(crate) fn migrate_webview_storage(legacy_profile: &Path, profile: &Path) -> Outcome {
    let from = legacy_profile.join("Local Storage");
    if !from.is_dir() {
        return Outcome::NothingToMigrate;
    }
    let to = profile.join("Local Storage");
    if to.exists() {
        return Outcome::AlreadyMigrated;
    }
    let staging = profile.join("Local Storage.migrating");
    let result = copy_dir_all(&from, &staging).and_then(|_| fs::rename(&staging, &to));
    match result {
        Ok(()) => Outcome::Migrated,
        Err(error) => {
            tracing::warn!(%error, "legacy webview storage copy failed");
            Outcome::Partial
        }
    }
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn scratch() -> PathBuf {
        let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "dawnsight-legacy-app-{}-{sequence}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("scratch");
        root
    }

    fn seed_legacy(legacy: &Path) {
        fs::create_dir_all(legacy.join("note-frames")).expect("frames");
        fs::create_dir_all(legacy.join("chapter-assets").join("task-1")).expect("assets");
        fs::create_dir_all(legacy.join("whisper")).expect("whisper");
        fs::create_dir_all(legacy.join("logs")).expect("logs");
        fs::write(legacy.join("notes.json"), b"{\"notes\":[]}").expect("notes");
        fs::write(legacy.join("note-frames").join("n1.jpg"), b"jpg").expect("frame");
        fs::write(
            legacy.join("chapter-assets").join("task-1").join("f.jpg"),
            b"asset",
        )
        .expect("asset");
        fs::write(legacy.join("whisper").join("ggml-base.bin"), b"model").expect("model");
        fs::write(legacy.join("lumina.sqlite3"), b"db").expect("db");
        fs::write(legacy.join("lumina.sqlite3-wal"), b"wal").expect("wal");
        fs::write(legacy.join("logs").join("lumina.log"), b"log").expect("log");
    }

    #[test]
    fn first_run_copies_user_data_and_moves_tool_folders() {
        let root = scratch();
        let (legacy, current) = (root.join("lumina"), root.join("dawnsight"));
        seed_legacy(&legacy);

        assert_eq!(migrate_app_data(&legacy, &current), Outcome::Migrated);

        assert_eq!(
            fs::read(current.join("dawnsight.sqlite3")).expect("db"),
            b"db"
        );
        assert_eq!(
            fs::read(current.join("dawnsight.sqlite3-wal")).expect("wal"),
            b"wal"
        );
        assert!(current.join("notes.json").is_file());
        assert!(current.join("note-frames").join("n1.jpg").is_file());
        assert!(current
            .join("chapter-assets")
            .join("task-1")
            .join("f.jpg")
            .is_file());
        assert!(current.join("whisper").join("ggml-base.bin").is_file());
        assert!(current.join(MARKER_FILE).is_file());
        // User data stays behind for the old install; tool folders moved; logs untouched.
        assert!(legacy.join("lumina.sqlite3").is_file());
        assert!(legacy.join("notes.json").is_file());
        assert!(!legacy.join("whisper").exists());
        assert!(!current.join("logs").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn second_run_is_a_no_op() {
        let root = scratch();
        let (legacy, current) = (root.join("lumina"), root.join("dawnsight"));
        seed_legacy(&legacy);
        assert_eq!(migrate_app_data(&legacy, &current), Outcome::Migrated);
        fs::write(current.join("notes.json"), b"edited after upgrade").expect("edit");
        fs::write(legacy.join("notes.json"), b"edited in old app").expect("old edit");

        assert_eq!(
            migrate_app_data(&legacy, &current),
            Outcome::AlreadyMigrated
        );
        assert_eq!(
            fs::read(current.join("notes.json")).expect("notes"),
            b"edited after upgrade"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn existing_dawnsight_data_is_never_overwritten() {
        let root = scratch();
        let (legacy, current) = (root.join("lumina"), root.join("dawnsight"));
        seed_legacy(&legacy);
        fs::create_dir_all(current.join("whisper")).expect("current whisper");
        fs::write(current.join("dawnsight.sqlite3"), b"newer db").expect("db");
        fs::write(current.join("notes.json"), b"newer notes").expect("notes");

        assert_eq!(migrate_app_data(&legacy, &current), Outcome::Migrated);

        assert_eq!(
            fs::read(current.join("dawnsight.sqlite3")).expect("db"),
            b"newer db"
        );
        assert!(!current.join("dawnsight.sqlite3-wal").exists());
        assert_eq!(
            fs::read(current.join("notes.json")).expect("notes"),
            b"newer notes"
        );
        assert!(legacy.join("whisper").join("ggml-base.bin").is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn nothing_happens_without_legacy_data() {
        let root = scratch();
        let (legacy, current) = (root.join("lumina"), root.join("dawnsight"));

        assert_eq!(
            migrate_app_data(&legacy, &current),
            Outcome::NothingToMigrate
        );
        assert!(!current.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    #[test]
    fn webview_storage_seeds_only_a_fresh_profile() {
        let root = scratch();
        let (legacy, fresh, used) = (root.join("old"), root.join("new"), root.join("used"));
        fs::create_dir_all(legacy.join("Local Storage").join("leveldb")).expect("legacy ls");
        fs::write(
            legacy
                .join("Local Storage")
                .join("leveldb")
                .join("000003.log"),
            b"lumina-session",
        )
        .expect("leveldb");
        fs::create_dir_all(used.join("Local Storage")).expect("used profile");

        assert_eq!(migrate_webview_storage(&legacy, &fresh), Outcome::Migrated);
        assert!(fresh
            .join("Local Storage")
            .join("leveldb")
            .join("000003.log")
            .is_file());
        assert!(!fresh.join("Local Storage.migrating").exists());

        assert_eq!(
            migrate_webview_storage(&legacy, &used),
            Outcome::AlreadyMigrated
        );
        assert!(!used.join("Local Storage").join("leveldb").exists());
        let _ = fs::remove_dir_all(&root);
    }
}
