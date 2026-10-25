//! Forward-copy of data written by the pre-rename app (Lumina, ≤ 0.4.1).
//!
//! Upgraded installs still have their data under the old names. Everything
//! here copies, never moves or deletes: the old install may still be launched
//! and must keep working, and a failed copy can simply be retried next time.
//! An existing destination is never overwritten.

use std::fs;
use std::io;
use std::path::Path;

use crate::paths::{dawnsight_dir, LEGACY_DIR_NAME};

/// Recursively copy `src` into `dst`, creating `dst` as needed.
///
/// Files that already exist under `dst` are left untouched, so a partially
/// finished earlier copy can be completed without clobbering newer data.
/// Returns the number of files copied.
pub fn copy_dir_all(src: &Path, dst: &Path) -> io::Result<u64> {
    fs::create_dir_all(dst)?;
    let mut copied = 0;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_dir() {
            copied += copy_dir_all(&from, &to)?;
        } else if kind.is_file() && !to.exists() {
            fs::copy(&from, &to)?;
            copied += 1;
        }
    }
    Ok(copied)
}

/// Copy a library root's `.lumina` folder to `.dawnsight` the first time a
/// read path touches that root. No-op when `.dawnsight` already exists or
/// there is nothing to migrate. Failures are logged and left for a retry:
/// the caller then simply sees an unindexed library, as before.
pub fn migrate_legacy_library_dir(root: &Path) {
    let target = dawnsight_dir(root);
    if target.exists() {
        return;
    }
    let legacy = root.join(LEGACY_DIR_NAME);
    if !legacy.is_dir() {
        return;
    }
    // Copy into a sibling first so an interrupted copy never looks complete.
    let staging = root.join(".dawnsight.migrating");
    let result = copy_dir_all(&legacy, &staging).and_then(|files| {
        fs::rename(&staging, &target)?;
        Ok(files)
    });
    match result {
        Ok(files) => tracing::info!(files, "migrated legacy library folder"),
        Err(error) => tracing::warn!(%error, "legacy library folder migration failed"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn scratch_root() -> PathBuf {
        let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "dawnsight-legacy-library-{}-{sequence}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("scratch root");
        root
    }

    fn seed_legacy(root: &Path) {
        let groups = root.join(".lumina").join("groups").join("show-1");
        fs::create_dir_all(&groups).expect("legacy groups");
        fs::write(root.join(".lumina").join("index.json"), b"{\"v\":1}").expect("legacy index");
        fs::write(
            groups.join("zh.srt"),
            b"1\n00:00:01,000 --> 00:00:02,000\nhi\n",
        )
        .expect("legacy subtitle");
    }

    #[test]
    fn copies_legacy_folder_and_keeps_the_original() {
        let root = scratch_root();
        seed_legacy(&root);

        migrate_legacy_library_dir(&root);

        assert_eq!(
            fs::read(root.join(".dawnsight").join("index.json")).expect("migrated index"),
            b"{\"v\":1}"
        );
        assert!(root
            .join(".dawnsight")
            .join("groups")
            .join("show-1")
            .join("zh.srt")
            .is_file());
        assert!(root.join(".lumina").join("index.json").is_file());
        assert!(!root.join(".dawnsight.migrating").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn never_touches_an_existing_dawnsight_folder() {
        let root = scratch_root();
        seed_legacy(&root);
        fs::create_dir_all(root.join(".dawnsight")).expect("new folder");
        fs::write(root.join(".dawnsight").join("index.json"), b"new").expect("new index");

        migrate_legacy_library_dir(&root);

        assert_eq!(
            fs::read(root.join(".dawnsight").join("index.json")).expect("index"),
            b"new"
        );
        assert!(!root.join(".dawnsight").join("groups").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn is_a_no_op_without_legacy_data() {
        let root = scratch_root();

        migrate_legacy_library_dir(&root);

        assert!(!root.join(".dawnsight").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_dir_all_completes_a_partial_copy_without_overwriting() {
        let root = scratch_root();
        let src = root.join("src");
        let dst = root.join("dst");
        fs::create_dir_all(src.join("nested")).expect("src");
        fs::write(src.join("a.txt"), b"old-a").expect("a");
        fs::write(src.join("nested").join("b.txt"), b"old-b").expect("b");
        fs::create_dir_all(&dst).expect("dst");
        fs::write(dst.join("a.txt"), b"kept").expect("existing a");

        let copied = copy_dir_all(&src, &dst).expect("copy");

        assert_eq!(copied, 1);
        assert_eq!(fs::read(dst.join("a.txt")).expect("a"), b"kept");
        assert_eq!(
            fs::read(dst.join("nested").join("b.txt")).expect("b"),
            b"old-b"
        );
        let _ = fs::remove_dir_all(&root);
    }
}
