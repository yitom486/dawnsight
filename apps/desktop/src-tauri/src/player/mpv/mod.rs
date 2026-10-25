//! App-side mpv glue: portable core is re-exported from `dawnsight-player`;
//! Tauri-bound `native_library` / `window` and the manual `baseline` stay here
//! (L2 player-crate audit §5).

pub use dawnsight_player::mpv::{LibMpvPlayer, NetworkPlaybackOpts};

#[cfg(test)]
mod baseline;
pub mod native_library;
#[cfg(test)]
mod osc_script;
pub mod window;
