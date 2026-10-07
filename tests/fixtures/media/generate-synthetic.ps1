param(
    [Parameter(Mandatory = $true)]
    [string]$RuntimeDir,
    [string]$OutputDir = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
$ffmpeg = Join-Path $RuntimeDir 'ffmpeg.exe'
$ffprobe = Join-Path $RuntimeDir 'ffprobe.exe'

if (-not (Test-Path $ffmpeg) -or -not (Test-Path $ffprobe)) {
    throw 'RuntimeDir must contain managed ffmpeg.exe and ffprobe.exe'
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$video = Join-Path $OutputDir 'synthetic-1080p.mp4'
$audio = Join-Path $OutputDir 'synthetic-audio.wav'
$image = Join-Path $OutputDir 'synthetic-image.png'

& $ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'testsrc2=size=1920x1080:rate=30' -f lavfi -i 'sine=frequency=1000:sample_rate=48000' -t 6 -c:v libx264 -pix_fmt yuv420p -c:a aac $video
if ($LASTEXITCODE -ne 0) { throw "managed FFmpeg video fixture generation failed with exit code $LASTEXITCODE" }

& $ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'sine=frequency=440:sample_rate=48000' -t 6 -c:a pcm_s16le $audio
if ($LASTEXITCODE -ne 0) { throw "managed FFmpeg audio fixture generation failed with exit code $LASTEXITCODE" }

& $ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'color=c=blue:size=1280x720:rate=1' -frames:v 1 -c:v png -threads 1 $image
if ($LASTEXITCODE -ne 0) { throw "managed FFmpeg image fixture generation failed with exit code $LASTEXITCODE" }

foreach ($fixture in @($video, $audio, $image)) {
    & $ffprobe -v error -show_entries 'stream=codec_type,width,height:format=duration' -of json $fixture
    if ($LASTEXITCODE -ne 0) {
        throw "managed FFprobe validation failed for $fixture with exit code $LASTEXITCODE"
    }
}
