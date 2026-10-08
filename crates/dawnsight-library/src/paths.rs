//! Shared path rules for the local media library and Lumina data dirs.
//!
//! All code that writes or reads `.lumina/**` or compares media paths against
//! library roots should go through this module so scan, index lookup, MCP tools,
//! and metadata I/O stay aligned.

use std::path::{Path, PathBuf};

use crate::error::LibraryError;

pub const DAWNSIGHT_DIR_NAME: &str = ".dawnsight";

/// Pre-rename data dir. Read-only fallback: after the lumina→dawnsight
/// rename, existing libraries only have `.lumina/index.json` + `groups`.
/// Reads fall back to it when the new location has nothing yet; every write
/// targets `.dawnsight`, so the next rescan migrates forward naturally.
pub const LEGACY_DIR_NAME: &str = ".lumina";

pub fn dawnsight_dir(root: &Path) -> PathBuf {
    root.join(DAWNSIGHT_DIR_NAME)
}

pub fn dawnsight_index_path(root: &Path) -> PathBuf {
    dawnsight_dir(root).join("index.json")
}

pub fn legacy_index_path(root: &Path) -> PathBuf {
    root.join(LEGACY_DIR_NAME).join("index.json")
}

/// Read-side index location: new dir wins when it has an index, otherwise
/// the pre-rename copy. Falls back to the new path (for future writes) when
/// neither exists.
pub fn index_path_for_read(root: &Path) -> PathBuf {
    let modern = dawnsight_index_path(root);
    if modern.is_file() {
        return modern;
    }
    let legacy = legacy_index_path(root);
    if legacy.is_file() {
        return legacy;
    }
    modern
}

pub fn dawnsight_groups_dir(root: &Path) -> PathBuf {
    dawnsight_dir(root).join("groups")
}

pub fn dawnsight_agent_context_path(cwd: &Path) -> PathBuf {
    dawnsight_dir(cwd).join("agent-context.json")
}

pub fn dawnsight_tmp_dir(cwd: &Path) -> PathBuf {
    dawnsight_dir(cwd).join("tmp")
}

pub fn is_dawnsight_data_dir(name: &str) -> bool {
    name == DAWNSIGHT_DIR_NAME
}

/// Normalize a path string to `/` separators and trim trailing slashes.
pub fn normalize_slashes(path: &Path) -> String {
    let mut normalized = path.to_string_lossy().replace('\\', "/");
    while normalized.ends_with('/') && normalized.len() > 1 {
        normalized.pop();
    }
    normalized
}

/// Return `media_path` relative to `library_root` using `/` separators.
pub fn relativize_under_root(root: &Path, media_path: &Path) -> Result<String, LibraryError> {
    let root_norm = normalize_slashes(root);
    let media_norm = normalize_slashes(media_path);
    if root_norm.is_empty() || media_norm.is_empty() {
        return Err(LibraryError::invalid_input("当前媒体不在已启用目录中"));
    }
    if !is_under_root(&root_norm, &media_norm) {
        return Err(LibraryError::invalid_input("当前媒体不在已启用目录中"));
    }
    let relative = media_norm
        .get(root_norm.len() + 1..)
        .ok_or_else(|| LibraryError::invalid_input("当前媒体不在已启用目录中"))?;
    if relative.is_empty() {
        return Err(LibraryError::invalid_input("当前媒体不在已启用目录中"));
    }
    Ok(relative.to_string())
}

/// Best-effort display path relative to `root`; falls back to normalized absolute path.
pub fn display_relative_path(root: &Path, path: &Path) -> String {
    relativize_under_root(root, path).unwrap_or_else(|_| normalize_slashes(path))
}

/// Walk parents of `media_path` looking for an index (new `.dawnsight` first,
/// then the pre-rename `.lumina` copy).
pub fn discover_library_root_for_media(media_path: &Path) -> Option<PathBuf> {
    let mut current = media_path.parent()?;
    loop {
        if dawnsight_index_path(current).is_file() || legacy_index_path(current).is_file() {
            return Some(current.to_path_buf());
        }
        current = current.parent()?;
    }
}

/// Best-effort library root for a media file.
///
/// Prefer the nearest `.lumina/index.json` walking up from the file so metadata
/// stored beside a show folder is found even when a broader configured root
/// (for example `D:\movie`) also contains the file.
pub fn library_root_for_media_path(
    configured_roots: impl IntoIterator<Item = PathBuf>,
    media_path: &Path,
) -> Option<PathBuf> {
    if let Some(discovered) = discover_library_root_for_media(media_path) {
        return Some(discovered);
    }
    configured_roots
        .into_iter()
        .filter(|root| is_media_under_root(root, media_path))
        .max_by_key(|root| root.as_os_str().len())
}

/// Whether `media_path` lives under a configured library root.
pub fn is_media_under_root(root: &Path, media_path: &Path) -> bool {
    let root_norm = normalize_slashes(root);
    let media_norm = normalize_slashes(media_path);
    is_under_root(&root_norm, &media_norm)
}

fn is_under_root(root: &str, media: &str) -> bool {
    if media == root {
        return false;
    }
    #[cfg(windows)]
    {
        media
            .to_ascii_lowercase()
            .starts_with(&format!("{}/", root.to_ascii_lowercase()))
    }
    #[cfg(not(windows))]
    {
        media.starts_with(&format!("{root}/"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn lumina_paths_share_one_dir_name() {
        let root = PathBuf::from("movie").join("Show");
        assert_eq!(
            dawnsight_index_path(&root),
            root.join(".dawnsight").join("index.json")
        );
        assert_eq!(
            dawnsight_agent_context_path(&root),
            root.join(".dawnsight").join("agent-context.json")
        );
    }

    #[test]
    fn relativize_nested_media_on_windows_style_paths() {
        let root = PathBuf::from(r"D:\movie\Show Folder");
        let media = PathBuf::from(r"D:\movie\Show Folder\S01E01.mkv");
        assert_eq!(
            relativize_under_root(&root, &media).expect("relative"),
            "S01E01.mkv"
        );
    }

    #[cfg(windows)]
    #[test]
    fn relativize_is_case_insensitive_on_windows() {
        let root = PathBuf::from(r"D:\Movie\Show");
        let media = PathBuf::from(r"d:\movie\show\ep.mkv");
        assert_eq!(
            relativize_under_root(&root, &media).expect("relative"),
            "ep.mkv"
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn relativize_nested_media_on_unix_paths() {
        let root = PathBuf::from("/movie/Show");
        let media = PathBuf::from("/movie/Show/ep.mkv");
        assert_eq!(
            relativize_under_root(&root, &media).expect("relative"),
            "ep.mkv"
        );
    }

    #[test]
    fn rejects_media_outside_root() {
        let root = PathBuf::from(r"D:\movie\A");
        let media = PathBuf::from(r"D:\movie\B\file.mkv");
        assert!(relativize_under_root(&root, &media).is_err());
    }

    #[test]
    fn legacy_lumina_index_is_discovered_when_new_dir_is_absent() {
        use std::time::{SystemTime, UNIX_EPOCH};

        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let show = std::env::temp_dir().join(format!("lumina-legacy-{suffix}"));
        let legacy = show.join(LEGACY_DIR_NAME);
        fs::create_dir_all(&legacy).expect("mkdir legacy");
        fs::write(
            legacy.join("index.json"),
            r#"{"schemaVersion":1,"root":"","updatedAtMs":0,"files":[],"groups":[]}"#,
        )
        .expect("write legacy index");
        let media = show.join("S01E01.mkv");
        fs::write(&media, b"").expect("write media");

        assert_eq!(discover_library_root_for_media(&media), Some(show.clone()));
        assert_eq!(index_path_for_read(&show), legacy.join("index.json"));
        let _ = fs::remove_dir_all(&show);
    }

    #[test]
    fn new_index_wins_over_legacy_copy() {
        use std::time::{SystemTime, UNIX_EPOCH};

        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let show = std::env::temp_dir().join(format!("lumina-both-{suffix}"));
        for dir in [DAWNSIGHT_DIR_NAME, LEGACY_DIR_NAME] {
            let target = show.join(dir);
            fs::create_dir_all(&target).expect("mkdir");
            fs::write(
                target.join("index.json"),
                r#"{"schemaVersion":1,"root":"","updatedAtMs":0,"files":[],"groups":[]}"#,
            )
            .expect("write index");
        }
        assert_eq!(index_path_for_read(&show), dawnsight_index_path(&show));
        let _ = fs::remove_dir_all(&show);
    }

    #[test]
    fn prefers_nearest_discovered_index_over_broader_configured_root() {
        use std::time::{SystemTime, UNIX_EPOCH};

        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let temp = std::env::temp_dir().join(format!("lumina-paths-{suffix}"));
        let show = temp.join("Show Folder");
        let nested_lumina = dawnsight_dir(&show);
        fs::create_dir_all(&nested_lumina).expect("mkdir nested lumina");
        fs::write(
            dawnsight_index_path(&show),
            r#"{"schemaVersion":1,"root":"","updatedAtMs":0,"files":[],"groups":[]}"#,
        )
        .expect("write nested index");
        let media = show.join("S01E01.mkv");
        fs::write(&media, b"").expect("write media");

        let configured = vec![temp.clone()];
        let resolved = library_root_for_media_path(configured, &media).expect("resolved root");
        assert_eq!(resolved, show);

        let _ = fs::remove_dir_all(&temp);
    }
}
