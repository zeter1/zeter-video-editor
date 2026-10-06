param(
    [Parameter(Mandatory = $true)]
    [string]$RuntimeDir,
    [string]$OutputDir = $PSScriptRoot
)

$ffmpeg = Join-Path $RuntimeDir 'ffmpeg.exe'
$ffprobe = Join-Path $RuntimeDir 'ffprobe.exe'

if (-not (Test-Path $ffmpeg) -or -not (Test-Path $ffprobe)) {
    throw 'RuntimeDir must contain managed ffmpeg.exe and ffprobe.exe'
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$output = Join-Path $OutputDir 'synthetic-1080p.mp4'

& $ffmpeg -y -f lavfi -i 'testsrc2=size=1920x1080:rate=30' -f lavfi -i 'sine=frequency=1000:sample_rate=48000' -t 2 -c:v libx264 -pix_fmt yuv420p -c:a aac $output
if ($LASTEXITCODE -ne 0) {
    throw "managed FFmpeg fixture generation failed with exit code $LASTEXITCODE"
}

& $ffprobe -v error -show_streams -show_format $output
if ($LASTEXITCODE -ne 0) {
    throw "managed FFprobe validation failed with exit code $LASTEXITCODE"
}
