param(
    [Parameter(Mandatory = $true)][string]$SourceDirectory,
    [string]$NdkDirectory = "$env:ANDROID_SDK_ROOT/ndk/27.1.12297006"
)

$ErrorActionPreference = 'Stop'
$revision = '7efde1b1296eaaa187b70e951894dde17527489c' # upstream v0.17.3
$source = (Resolve-Path -LiteralPath $SourceDirectory).Path
$actualRevision = & git -C $source rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $actualRevision -ne $revision) {
    throw "Expected ByeDPI v0.17.3 at commit $revision"
}
$changes = & git -C $source status --porcelain
if ($LASTEXITCODE -ne 0 -or $changes) { throw 'ByeDPI source checkout must be clean' }

$tools = Join-Path $NdkDirectory 'toolchains/llvm/prebuilt/windows-x86_64/bin'
$root = Split-Path $PSScriptRoot -Parent
$output = Join-Path $root 'performance-captures/byedpi-build/libciadpi.so'
New-Item -ItemType Directory -Force (Split-Path $output -Parent) | Out-Null
$sources = @('packets.c', 'main.c', 'conev.c', 'proxy.c', 'desync.c', 'mpool.c', 'extend.c') |
    ForEach-Object { Join-Path $source $_ }
# This is an Android PIE executable packaged as .so, not a JNI shared library.
# Both page-size flags are required for older NDKs: LOAD alignment alone is insufficient.
& "$tools/clang.exe" --target=aarch64-linux-android24 -D_DEFAULT_SOURCE "-I$source" `
    -std=c99 -O2 -fPIE -pie -Wall -Wno-unused -Wextra -Wno-unused-parameter `
    '-Wl,-z,max-page-size=16384' '-Wl,-z,common-page-size=16384' `
    '-Wl,-z,relro' '-Wl,-z,now' '-Wl,--build-id=sha1' -o $output @sources
if ($LASTEXITCODE -ne 0) { throw 'ByeDPI compilation failed' }
& "$tools/llvm-strip.exe" --strip-all $output
if ($LASTEXITCODE -ne 0) { throw 'ByeDPI stripping failed' }

$headers = & "$tools/llvm-readelf.exe" -W -l $output
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect ByeDPI ELF headers' }
$loads = @($headers | Where-Object { $_ -match '^\s+LOAD\s' })
if (!$loads.Count) { throw 'ELF contains no LOAD segments' }
foreach ($line in $loads) {
    $alignment = [Convert]::ToInt64(($line.Trim() -split '\s+')[-1].Substring(2), 16)
    if ($alignment -lt 16384) { throw "Unaligned LOAD segment: $line" }
}
$relro = @($headers | Where-Object { $_ -match '^\s+GNU_RELRO\s' })
if (!$relro.Count) { throw 'Missing RELRO protection' }
foreach ($line in $relro) {
    $fields = $line.Trim() -split '\s+'
    $address = [Convert]::ToInt64($fields[2].Substring(2), 16)
    $size = [Convert]::ToInt64($fields[5].Substring(2), 16)
    if (($address + $size) % 16384 -ne 0) { throw "Unaligned RELRO boundary: $line" }
}
if (!($headers -match '/system/bin/linker64')) { throw 'Missing Android executable interpreter' }

$destination = Join-Path $root 'native-src/android/jniLibs/arm64-v8a/libciadpi.so'
Copy-Item -LiteralPath $output -Destination $destination -Force
# Keep an existing generated Android project in sync; Expo prebuild also copies this file.
$generated = Join-Path $root 'android/app/src/main/jniLibs/arm64-v8a/libciadpi.so'
if (Test-Path -LiteralPath (Split-Path $generated -Parent)) {
    Copy-Item -LiteralPath $output -Destination $generated -Force
}
Write-Output 'ByeDPI rebuilt: LOAD and RELRO pass 16 KB alignment checks.'
Get-FileHash -LiteralPath $destination -Algorithm SHA256
