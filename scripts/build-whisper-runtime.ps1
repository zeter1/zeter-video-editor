param(
    [string]$OutputDir = (Join-Path $PSScriptRoot "..\target\whisper-runtime"),
    [string]$Commit = "927cfce34f31707e17f2bff35c349632fb9e2c3a",
    [string]$Version = "1.9.4"
)

$ErrorActionPreference = "Stop"

$source = Join-Path $OutputDir "source"
$build = Join-Path $OutputDir "build"
$published = Join-Path $OutputDir "whisper-cli.exe"

if (Test-Path -LiteralPath $OutputDir) { Remove-Item -LiteralPath $OutputDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

git init $source | Out-Null
git -C $source remote add origin "https://github.com/ggml-org/whisper.cpp.git"
git -C $source fetch --depth 1 origin $Commit
if ($LASTEXITCODE -ne 0) { throw "Failed to fetch pinned whisper.cpp commit $Commit" }
git -C $source checkout --detach FETCH_HEAD
if ($LASTEXITCODE -ne 0) { throw "Failed to checkout pinned whisper.cpp commit $Commit" }
$actualCommit = (git -C $source rev-parse HEAD).Trim()
if ($actualCommit -ne $Commit) { throw "whisper.cpp checkout mismatch: expected $Commit, got $actualCommit" }

cmake -S $source -B $build -A x64 -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DWHISPER_BUILD_IS_DEV=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON
if ($LASTEXITCODE -ne 0) { throw "whisper.cpp CMake configure failed" }

cmake --build $build --config Release --target whisper-cli
if ($LASTEXITCODE -ne 0) { throw "whisper.cpp whisper-cli build failed" }

$candidate = Get-ChildItem -LiteralPath (Join-Path $build "bin") -Recurse -Filter "whisper-cli.exe" -File | Select-Object -First 1
if (-not $candidate) { throw "whisper-cli.exe was not produced" }

Copy-Item -LiteralPath $candidate.FullName -Destination $published -Force
$versionOutput = (& $published --version 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0 -or -not $versionOutput.Contains("whisper.cpp version: $Version")) { throw "whisper-cli version mismatch: $versionOutput" }

@{
    whisper_cli = (Resolve-Path -LiteralPath $published).Path
    version = $Version
    commit = $Commit
} | ConvertTo-Json | Set-Content (Join-Path $OutputDir "paths.json") -Encoding utf8

Write-Host "Built pinned whisper.cpp $Version ($Commit): $published"
