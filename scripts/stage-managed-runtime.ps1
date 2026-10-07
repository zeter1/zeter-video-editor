param(
    [Parameter(Mandatory = $true)]
    [string]$FfmpegPath,
    [Parameter(Mandatory = $true)]
    [string]$FfprobePath,
    [Parameter(Mandatory = $true)]
    [string]$WhisperCliPath,
    [Parameter(Mandatory = $true)]
    [string]$AiWorkerPath,
    [string]$TargetTriple = "x86_64-pc-windows-msvc"
)

$ErrorActionPreference = "Stop"

$inputs = @{
    "ffmpeg" = (Resolve-Path -LiteralPath $FfmpegPath).Path
    "ffprobe" = (Resolve-Path -LiteralPath $FfprobePath).Path
    "whisper-cli" = (Resolve-Path -LiteralPath $WhisperCliPath).Path
    "zeter-ai-worker" = (Resolve-Path -LiteralPath $AiWorkerPath).Path
}

$destination = Join-Path $PSScriptRoot "..\apps\desktop\src-tauri\binaries"
New-Item -ItemType Directory -Force $destination | Out-Null

foreach ($name in $inputs.Keys) {
    $target = Join-Path $destination "$name-$TargetTriple.exe"
    Copy-Item -LiteralPath $inputs[$name] -Destination $target -Force
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
        throw "Failed to stage managed runtime component: $name"
    }
}

Write-Host "Staged managed runtime sidecars for $TargetTriple in $destination"
