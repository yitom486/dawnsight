//! ACP session workspace (cwd resolution).

use sha2::{Digest, Sha256};
use std::path::PathBuf;

use super::error::AcpError;

/// Resolve an absolute session `cwd` for ACP.
///
/// Preference: explicit hint (directory, or parent of a media file) → process cwd.
/// Relative hints are joined with the process cwd. ACP requires an absolute path.
pub fn resolve_session_cwd(hint: Option<&str>) -> Result<PathBuf, AcpError> {
    if let Some(raw) = hint.map(str::trim).filter(|s| !s.is_empty()) {
        if raw.to_ascii_lowercase().starts_with("http://")
            || raw.to_ascii_lowercase().starts_with("https://")
        {
            tracing::warn!(cwd_hint = raw, "rejected remote URL as ACP workspace");
            return Err(AcpError::workspace_unavailable(Some(
                "remote URL cannot be used as ACP cwd",
            )));
        }
        let path = PathBuf::from(raw);
        let absolute = if path.is_absolute() {
            path
        } else {
            let base = std::env::current_dir().map_err(|error| {
                AcpError::internal(Some(&format!("current_dir failed: {error}")))
            })?;
            base.join(path)
        };

        if absolute.is_dir() {
            return Ok(normalize_abs(absolute));
        }
        if absolute.is_file() {
            if let Some(parent) = absolute.parent().filter(|parent| parent.is_dir()) {
                return Ok(normalize_abs(parent.to_path_buf()));
            }
        }
        tracing::warn!(cwd = %absolute.display(), "ACP workspace is not an existing directory");
        return Err(AcpError::workspace_unavailable(Some(&format!(
            "workspace does not exist or is not a directory: {}",
            absolute.display()
        ))));
    }

    let workspace = default_session_cwd();
    std::fs::create_dir_all(&workspace).map_err(|error| {
        tracing::warn!(cwd = %workspace.display(), %error, "failed to create default ACP workspace");
        AcpError::workspace_unavailable(Some(&format!(
            "create default workspace {}: {error}",
            workspace.display()
        )))
    })?;
    Ok(normalize_abs(workspace))
}

pub(crate) fn default_session_cwd() -> PathBuf {
    #[cfg(windows)]
    if let Some(base) = std::env::var_os("APPDATA") {
        return PathBuf::from(base).join("lumina").join("acp-workspace");
    }

    #[cfg(target_os = "macos")]
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("lumina")
            .join("acp-workspace");
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(base) = std::env::var_os("XDG_DATA_HOME") {
            return PathBuf::from(base).join("lumina").join("acp-workspace");
        }
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home)
                .join(".local")
                .join("share")
                .join("lumina")
                .join("acp-workspace");
        }
    }

    std::env::temp_dir().join("lumina").join("acp-workspace")
}

fn normalize_abs(path: PathBuf) -> PathBuf {
    // Best-effort canonicalize; fall back to the absolute path we already have.
    match path.canonicalize() {
        Ok(canonical) => strip_verbatim_prefix(canonical),
        Err(_) => path,
    }
}

/// Windows `canonicalize` returns `\\?\C:\...` verbatim paths. Codex tolerates
/// them, but some agents' Go fs layers percent-encode the prefix into
/// `file://%3F/...` and panic (`invalid URL escape "%3F"`), killing every
/// `session/new`. Agents therefore always get the plain `C:\...` spelling
/// (UNC keeps the `\\server\share` form).
#[cfg(windows)]
fn strip_verbatim_prefix(path: PathBuf) -> PathBuf {
    let Some(text) = path.as_os_str().to_str() else {
        return path;
    };
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path
    }
}

#[cfg(not(windows))]
fn strip_verbatim_prefix(path: PathBuf) -> PathBuf {
    path
}

/// Compare two workspace spellings for the same directory.
///
/// The request `cwd` is canonicalized (`\\?\D:\...` verbatim on Windows)
/// while a stored hint keeps the spelling the frontend sent (`D:\...`).
/// A plain string compare therefore always reports `scope_mismatch` on
/// Windows and resume is skipped forever. Strip the verbatim prefix,
/// unify separators and trailing slashes (and case on Windows, whose
/// filesystem is case-insensitive) before comparing. Pure string work:
/// no IO, infallible, so it can never turn a match into a new error.
pub fn same_workspace(a: &str, b: &str) -> bool {
    normalize_workspace_spelling(a) == normalize_workspace_spelling(b)
}

fn normalize_workspace_spelling(raw: &str) -> String {
    let mut value = raw.trim().replace('/', "\\");
    if let Some(stripped) = value.strip_prefix("\\\\?\\UNC\\") {
        value = format!("\\\\{stripped}");
    } else if let Some(stripped) = value.strip_prefix("\\\\?\\") {
        value = stripped.to_string();
    }
    while value.len() > 1 && value.ends_with('\\') {
        value.pop();
    }
    #[cfg(windows)]
    {
        value.to_ascii_lowercase()
    }
    #[cfg(not(windows))]
    {
        value
    }
}

/// Resolve the on-disk workspace an agent session actually runs in.
///
/// Measured: a non-ASCII session cwd (e.g. a CJK media directory) slows
/// some agents' prompts ~20x (5s -> 117s same model/prompt). The session
/// directory therefore stays ASCII: the media directory maps to a stable
/// `ws-<sha256>` slot under the default root, so sessions stay separated
/// per media location and stable across restarts. Media itself always
/// travels as data (prompt text, snapshot anchor), never as cwd.
pub fn resolve_agent_workspace(hint: Option<&str>) -> Result<PathBuf, AcpError> {
    if hint.map(str::trim).is_none_or(str::is_empty) {
        return resolve_session_cwd(None);
    }
    let media_dir = resolve_session_cwd(hint)?;
    let root = default_session_cwd();
    let mut hasher = Sha256::new();
    hasher.update(normalize_workspace_spelling(&media_dir.to_string_lossy()).as_bytes());
    let digest = format!("{:x}", hasher.finalize());
    let workspace = root.join(format!("ws-{}", &digest[..16]));
    std::fs::create_dir_all(&workspace).map_err(|error| {
        tracing::warn!(cwd = %workspace.display(), %error, "failed to create hashed ACP workspace");
        AcpError::workspace_unavailable(Some(&format!(
            "create agent workspace {}: {error}",
            workspace.display()
        )))
    })?;
    Ok(workspace)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_cwd_uses_writable_app_workspace_when_hint_missing() {
        let cwd = resolve_session_cwd(None).expect("cwd");
        assert!(cwd.is_absolute());
        assert!(cwd.is_dir());
        assert!(cwd.ends_with("acp-workspace"));
    }

    #[test]
    fn resolve_cwd_rejects_remote_urls_with_business_error() {
        let error = resolve_session_cwd(Some("https://www.youtube.com/watch?v=test"))
            .expect_err("URL must not become cwd");
        assert_eq!(
            error.code,
            crate::acp::error::AcpErrorCode::WorkspaceUnavailable
        );
        assert!(error.message.contains("工作目录"));
        assert!(!error.message.contains("https"));
    }

    #[test]
    fn resolve_cwd_takes_parent_of_file_hint() {
        let tmp = std::env::temp_dir().join("lumina-acp-cwd-file.mp4");
        let _ = std::fs::write(&tmp, b"x");
        let cwd = resolve_session_cwd(Some(tmp.to_str().expect("utf8"))).expect("cwd");
        let parent = tmp.parent().expect("parent");
        assert!(same_workspace(
            &cwd.to_string_lossy(),
            &parent.to_string_lossy()
        ));
        let _ = std::fs::remove_file(&tmp);
    }

    #[cfg(windows)]
    #[test]
    fn resolve_cwd_never_carries_the_verbatim_prefix() {
        let cwd = resolve_session_cwd(None).expect("cwd");
        let text = cwd.to_string_lossy();
        assert!(
            !text.starts_with(r"\\?\"),
            "agents must receive plain paths, got {text}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn strip_verbatim_handles_drive_and_unc() {
        assert_eq!(
            strip_verbatim_prefix(PathBuf::from(r"\\?\C:\movie\x")),
            PathBuf::from(r"C:\movie\x")
        );
        assert_eq!(
            strip_verbatim_prefix(PathBuf::from(r"\\?\UNC\server\share\x")),
            PathBuf::from(r"\\server\share\x")
        );
        assert_eq!(
            strip_verbatim_prefix(PathBuf::from(r"C:\plain\x")),
            PathBuf::from(r"C:\plain\x")
        );
    }

    #[test]
    fn same_workspace_ignores_verbatim_prefix_and_separators() {
        // Canonical request spelling vs the raw frontend hint: the exact
        // pair that used to force `scope_mismatch` on every Windows resume.
        assert!(same_workspace("\\\\?\\D:\\movie\\x", "D:\\movie\\x",));
        assert!(same_workspace("D:/movie/x/", "D:\\movie\\x"));
        assert!(!same_workspace("D:\\movie\\a", "D:\\movie\\b"));
        assert!(!same_workspace("", "D:\\movie\\x"));
    }

    #[cfg(windows)]
    #[test]
    fn same_workspace_is_case_insensitive_on_windows() {
        assert!(same_workspace("D:\\Movie\\x", "d:\\movie\\X"));
    }

    #[test]
    fn agent_workspace_is_stable_ascii_and_per_directory() {
        let base = std::env::temp_dir().join("lumina-acp-ws-test");
        let dir_a = base.join("剧集A");
        let dir_b = base.join("剧集B");
        std::fs::create_dir_all(&dir_a).expect("mkdir a");
        std::fs::create_dir_all(&dir_b).expect("mkdir b");
        let wa1 = resolve_agent_workspace(Some(dir_a.to_str().expect("utf8"))).expect("ws a");
        let wa2 = resolve_agent_workspace(Some(dir_a.to_str().expect("utf8"))).expect("ws a again");
        let wb = resolve_agent_workspace(Some(dir_b.to_str().expect("utf8"))).expect("ws b");
        // Stable across calls, separated per media directory.
        assert_eq!(wa1, wa2);
        assert_ne!(wa1, wb);
        // Pure ASCII: safe for every agent's cwd handling.
        for path in [&wa1, &wb] {
            assert!(
                path.to_string_lossy().is_ascii(),
                "agent workspace must be ASCII, got {}",
                path.display()
            );
            assert!(path.is_dir());
        }
        // No hint falls back to the default root itself.
        let root = resolve_agent_workspace(None).expect("default root");
        assert!(root.ends_with("acp-workspace"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn agent_workspace_rejects_remote_urls() {
        let error = resolve_agent_workspace(Some("https://example.com/v.mp4"))
            .expect_err("remote URL errors");
        assert_eq!(
            error.code,
            crate::acp::error::AcpErrorCode::WorkspaceUnavailable
        );
    }
}
