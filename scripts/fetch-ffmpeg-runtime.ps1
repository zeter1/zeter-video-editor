param(
    [Parameter(Mandatory = $true)]
    [string]$Url,
    [Parameter(Mandatory = $true)]
    [string]$Sha256,
    [Parameter(Mandatory = $true)]
    [string]$OutputDir
)

$ErrorActionPreference = "Stop"
if (-not $Url.StartsWith("https://", [StringComparison]::OrdinalIgnoreCase)) {
    throw "FFmpeg release URL must use HTTPS."
}
if ($Sha256 -notmatch "^[0-9A-Fa-f]{64}$") {
    throw "FFmpeg archive SHA-256 must contain exactly 64 hexadecimal characters."
}

New-Item -ItemType Directory -Force $OutputDir | Out-Null
$archive = Join-Path $OutputDir "ffmpeg-runtime.zip"
Invoke-WebRequest -Uri $Url -OutFile $archive -UseBasicParsing

$actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
if (-not $actual.Equals($Sha256, [StringComparison]::OrdinalIgnoreCase)) {
    throw "FFmpeg archive checksum mismatch."
}

$expanded = Join-Path $OutputDir "expanded"
Remove-Item $expanded -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -LiteralPath $archive -DestinationPath $expanded -Force

$ffmpeg = @(Get-ChildItem $expanded -Recurse -Filter "ffmpeg.exe" -File)
$ffprobe = @(Get-ChildItem $expanded -Recurse -Filter "ffprobe.exe" -File)
if ($ffmpeg.Count -ne 1 -or $ffprobe.Count -ne 1) {
    throw "Expected exactly one ffmpeg.exe and one ffprobe.exe in the verified archive."
}

@{
    ffmpeg = $ffmpeg[0].FullName
    ffprobe = $ffprobe[0].FullName
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDir "paths.json")
