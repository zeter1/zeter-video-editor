# Media fixtures

Task 7 keeps parser unit tests deterministic by storing captured text fixtures inside
`crates/media-engine/tests/fixtures/`.

Real FFmpeg/FFprobe integration is intentionally optional until application-managed
sidecars are provisioned. On Windows, point `ZETER_TEST_FFMPEG_DIR` at a directory
containing the version-matched `ffmpeg.exe` and `ffprobe.exe`, then run:

```powershell
$env:ZETER_TEST_FFMPEG_DIR = 'C:\path\to\managed-ffmpeg'
cargo test -p media-engine --test managed_ffmpeg -- --nocapture
```

Do not use an arbitrary FFmpeg discovered through `PATH` as product runtime evidence.
Future synthetic media fixtures should be generated with the managed runtime and document
the exact command plus build identity used to create them.
