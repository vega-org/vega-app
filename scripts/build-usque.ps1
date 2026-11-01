param(
    [Parameter(Mandatory = $true)][string]$SourceDirectory,
    [ValidateSet('arm64-v8a', 'armeabi-v7a')]
    [string]$Abi = 'arm64-v8a',
    [string]$GoExecutable = 'go',
    [string]$NdkDirectory = "$env:ANDROID_SDK_ROOT/ndk/27.1.12297006"
)

$ErrorActionPreference = 'Stop'
$revision = '6aa03fc97d12848dce34eedbd187fb1077b5d1ea' # Diniboy1123/usque v1.5.1-0.20260720063354-6aa03fc97d12
$goVersion = 'go1.26.3'
$source = (Resolve-Path -LiteralPath $SourceDirectory).Path
$actualRevision = & git -C $source rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $actualRevision -ne $revision) {
    throw "Expected usque at commit $revision"
}
$changes = & git -C $source status --porcelain
if ($LASTEXITCODE -ne 0 -or $changes) { throw 'usque source checkout must be clean' }
$actualGo = & $GoExecutable env GOVERSION
if ($LASTEXITCODE -ne 0 -or $actualGo -ne $goVersion) { throw "Expected $goVersion, found $actualGo" }

$tools = Join-Path $NdkDirectory 'toolchains/llvm/prebuilt/windows-x86_64/bin'
$root = Split-Path $PSScriptRoot -Parent
$output = Join-Path $root "performance-captures/usque-build/$Abi/libusque.so"
New-Item -ItemType Directory -Force (Split-Path $output -Parent) | Out-Null

# arm64 is a static Go executable. Go cannot link android/arm without cgo, so the 32-bit build
# uses the NDK clang as external linker (the result is a PIE linked against libc/libdl/liblog).
$saved = @{}
foreach ($name in 'GOOS', 'GOARCH', 'GOARM', 'CGO_ENABLED', 'CC', 'GOFLAGS', 'GOTOOLCHAIN') {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
    $env:GOOS = 'android'
    $env:GOFLAGS = '-mod=readonly'
    $env:GOTOOLCHAIN = 'local'
    if ($Abi -eq 'armeabi-v7a') {
        $env:GOARCH = 'arm'
        $env:GOARM = '7'
        $env:CGO_ENABLED = '1'
        $env:CC = Join-Path $tools 'armv7a-linux-androideabi24-clang.cmd'
    } else {
        $env:GOARCH = 'arm64'
        Remove-Item Env:GOARM -ErrorAction SilentlyContinue
        $env:CGO_ENABLED = '0'
    }
    Push-Location $source
    try {
        & $GoExecutable build -trimpath -ldflags '-s -w' -o $output .
        if ($LASTEXITCODE -ne 0) { throw 'usque compilation failed' }
    } finally {
        Pop-Location
    }
} finally {
    foreach ($name in $saved.Keys) {
        [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process')
    }
}

$headers = & "$tools/llvm-readelf.exe" -W -h -l $output
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect usque ELF headers' }
$expectedClass = if ($Abi -eq 'armeabi-v7a') { 'ELF32' } else { 'ELF64' }
$expectedMachine = if ($Abi -eq 'armeabi-v7a') { 'ARM' } else { 'AArch64' }
$expectedInterpreter = if ($Abi -eq 'armeabi-v7a') { '/system/bin/linker(?!\d)' } else { '/system/bin/linker64' }
if (!($headers -match "Class:\s+$expectedClass\b")) { throw "Expected $expectedClass binary" }
if (!($headers -match "Machine:\s+$expectedMachine\b")) { throw "Expected $expectedMachine binary" }
if (!($headers -match $expectedInterpreter)) { throw 'Missing Android executable interpreter' }
if (!($headers -match 'Type:\s+DYN\b')) { throw 'usque must be a PIE executable' }

$destination = Join-Path $root "native-src/android/jniLibs/$Abi/libusque.so"
New-Item -ItemType Directory -Force (Split-Path $destination -Parent) | Out-Null
Copy-Item -LiteralPath $output -Destination $destination -Force
# Keep an existing generated Android project in sync; Expo prebuild also copies this file.
$generated = Join-Path $root "android/app/src/main/jniLibs/$Abi/libusque.so"
if (Test-Path -LiteralPath (Split-Path $generated -Parent)) {
    Copy-Item -LiteralPath $output -Destination $generated -Force
}
Write-Output "usque ($Abi) rebuilt: ELF class, machine and interpreter checks pass."
Get-FileHash -LiteralPath $destination -Algorithm SHA256
