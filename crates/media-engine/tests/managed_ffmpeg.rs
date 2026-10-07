#![cfg(windows)]

use std::{env, path::PathBuf};

use media_engine::{detect_capabilities, ManagedRuntime};

#[test]
fn real_managed_ffmpeg_is_detectable_when_fixture_directory_is_configured() {
    let Ok(dir) = env::var("ZETER_TEST_FFMPEG_DIR") else {
        eprintln!("SKIP: set ZETER_TEST_FFMPEG_DIR to run the managed FFmpeg integration test");
        return;
    };

    let runtime = ManagedRuntime::from_dir(PathBuf::from(dir), "integration-test");
    assert!(
        runtime.ffmpeg_path.is_file(),
        "managed ffmpeg.exe is missing: {}",
        runtime.ffmpeg_path.display()
    );
    assert!(
        runtime.ffprobe_path.is_file(),
        "managed ffprobe.exe is missing: {}",
        runtime.ffprobe_path.display()
    );

    let capabilities =
        detect_capabilities(&runtime).expect("managed ffmpeg should report encoder capabilities");

    assert!(
        capabilities.software.h264
            || capabilities.nvenc.h264
            || capabilities.qsv.h264
            || capabilities.amf.h264,
        "managed ffmpeg should expose at least one H.264 encoder"
    );
}
