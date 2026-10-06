# Synthetic media fixtures

Task 7 keeps parser tests independent from private creator media.

- FFprobe unit tests use captured synthetic JSON embedded in the test.
- Real FFmpeg/FFprobe integration on Windows is opt-in through `ZETER_TEST_FFMPEG_DIR`.
- Later media/render tasks may generate tiny synthetic clips with the managed FFmpeg sidecar and keep only scripts/metadata in this directory unless a binary fixture is genuinely required.
