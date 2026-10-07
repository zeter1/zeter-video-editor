# Windows release and managed runtime

Task 18 makes Windows packaging explicit and fail-closed.

## Runtime boundary

The shipped application uses only the managed runtime components listed in `runtime-manifest.json`:
- `ffmpeg.exe`
- `ffprobe.exe`
- `zeter-ai-worker.exe`

Product runtime code never searches `PATH`. In development/tests, `ZETER_MANAGED_RUNTIME_DIR` may explicitly point at a managed runtime directory containing the manifest filenames `ffmpeg.exe`, `ffprobe.exe`, and `zeter-ai-worker.exe`. In an installed build the default runtime root is the directory containing the application executable.

Tauri packaging inputs are staged separately into `apps/desktop/src-tauri/binaries/` with the target-triple suffix required by Tauri. That generated build-input directory is not itself a runtime root and must not be committed.

## FFmpeg redistribution

A production release must set repository variables:
- `ZETER_FFMPEG_ARCHIVE_URL` — HTTPS URL to the reviewed Windows x64 FFmpeg archive.
- `ZETER_FFMPEG_ARCHIVE_SHA256` — exact SHA-256 for that archive.

The release workflow downloads the archive, verifies the SHA-256 before extraction, and stages exactly one `ffmpeg.exe` and `ffprobe.exe`. Update `runtime-manifest.json` when the pinned FFmpeg/FFprobe build identity changes. Review redistribution/license obligations before publishing.

## Update signing

Tauri updater signatures are mandatory. Production CI requires:
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `TAURI_UPDATER_PUBLIC_KEY`

The committed `tauri.conf.json` intentionally contains a non-production updater public-key marker. The release job injects the real public key through a generated config override. Do not publish an installer built with the marker.

## Windows Authenticode signing

Production CI also requires:
- `WINDOWS_CERTIFICATE` — base64-encoded PFX/PKCS#12 certificate.
- `WINDOWS_CERTIFICATE_PASSWORD`

The release job imports the certificate into the current-user certificate store, injects the certificate thumbprint into a temporary Tauri config override, builds the NSIS installer, and verifies that Windows reports a valid Authenticode signature before publication.

## Debug bundle smoke

CI uses `release/tauri.debug.conf.json` to disable updater-artifact generation only for the unsigned debug bundle smoke. This does not weaken the production config: `tauri.conf.json` keeps `createUpdaterArtifacts: true`, and the production release job fails closed when signing inputs are absent.

The debug smoke may stage the GitHub runner's explicitly resolved FFmpeg executables as build inputs. This is only a packaging smoke and is not a production runtime provenance claim.
