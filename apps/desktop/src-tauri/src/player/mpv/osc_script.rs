//! Headless smoke test for the tracked OSC/HUD skin (`native/osc/dawnsight-osc.lua`).
//!
//! mpv only reports Lua failures through its log, so a broken script would
//! otherwise ship silently. Load the real file into a `vo=null` libmpv, drive
//! the property changes and script messages the skin reacts to, and fail on
//! any error-level log line from the script.

use std::ffi::CString;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use libmpv2::events::Event;
use libmpv2::Mpv;

/// Set by the script as its last top-level statement.
const LOADED_FLAG: &str = "user-data/dawnsight-osc/loaded";

#[derive(Default)]
struct ScriptLog {
    file_loaded: bool,
    errors: Vec<String>,
}

fn drain_for(mpv: &Mpv, log: &mut ScriptLog, window: Duration) {
    let deadline = Instant::now() + window;
    while Instant::now() < deadline {
        let Some(event) = mpv.wait_event(0.05) else {
            continue;
        };
        match event {
            Ok(Event::FileLoaded) => log.file_loaded = true,
            Ok(Event::LogMessage {
                prefix,
                level,
                text,
                ..
            }) if prefix.contains("dawnsight") => {
                if matches!(level, "error" | "fatal") {
                    log.errors.push(format!("[{prefix}] {}", text.trim_end()));
                }
            }
            _ => {}
        }
    }
}

#[test]
fn osc_skin_loads_and_survives_driven_state_changes() {
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("native")
        .join("osc")
        .join("dawnsight-osc.lua");
    assert!(script.is_file(), "tracked OSC skin missing");
    let script = script.to_string_lossy().into_owned();

    let mpv = Mpv::with_initializer(|init| {
        init.set_option("vo", "null")?;
        init.set_option("ao", "null")?;
        init.set_option("idle", "yes")?;
        init.set_option("terminal", "no")?;
        init.set_option("osc", "no")?;
        init.set_option("scripts", script.as_str())?;
        Ok(())
    })
    .expect("headless libmpv should initialize");
    let level = CString::new("info").expect("static log level");
    let requested =
        unsafe { libmpv2_sys::mpv_request_log_messages(mpv.ctx.as_ptr(), level.as_ptr()) };
    assert!(requested >= 0, "log messages should be available");

    let mut log = ScriptLog::default();
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut loaded = false;
    while !loaded && Instant::now() < deadline {
        drain_for(&mpv, &mut log, Duration::from_millis(100));
        loaded = mpv.get_property::<bool>(LOADED_FLAG).unwrap_or(false);
    }
    assert!(loaded, "script never finished loading: {:?}", log.errors);

    mpv.command(
        "loadfile",
        &[
            "av://lavfi:testsrc=size=320x240:rate=10:duration=20",
            "replace",
        ],
    )
    .expect("lavfi test source should be accepted");
    // Past the HUD's post-load quiet period so the toast paths actually run.
    drain_for(&mpv, &mut log, Duration::from_millis(2500));
    assert!(log.file_loaded, "lavfi test source never loaded");

    let mode = |value: &str| {
        mpv.command("script-message", &["dawnsight-surface-mode", value])
            .expect("surface mode message");
    };
    let mouse = |phase: &str, x: &str, y: &str| {
        mpv.command("script-message", &["dawnsight-surface-mouse", phase, x, y])
            .expect("surface mouse message");
    };

    for fullscreen in ["windowed", "fullscreen"] {
        mode(fullscreen);
        mouse("move", "640", "700");
        mpv.set_property("pause", true).expect("pause");
        mpv.set_property("pause", false).expect("resume");
        mpv.command("seek", &["5", "absolute"]).expect("seek");
        mpv.set_property("volume", 35_i64).expect("volume");
        mpv.set_property("mute", true).expect("mute");
        mpv.set_property("mute", false).expect("unmute");
        mpv.set_property("speed", 1.5_f64).expect("speed");
        mpv.set_property("sid", "no").expect("subtitle off");
        mouse("click", "640", "360");
        mouse("leave", "-1", "-1");
        drain_for(&mpv, &mut log, Duration::from_millis(1500));
    }

    mpv.command("stop", &[]).expect("stop");
    drain_for(&mpv, &mut log, Duration::from_millis(500));

    assert!(
        log.errors.is_empty(),
        "OSC skin logged errors: {:#?}",
        log.errors
    );
}
