$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$targetDirectory = Join-Path $projectRoot 'resources\bin'
$targetPath = Join-Path $targetDirectory 'ffmpeg.exe'

if (Test-Path -LiteralPath $targetPath) {
    Write-Host 'FFmpeg is ready.'
    exit 0
}

$downloadBase = 'https://www.gyan.dev/ffmpeg/builds'
$archiveUrl = "$downloadBase/ffmpeg-release-essentials.zip"
$checksumUrl = "$archiveUrl.sha256"
$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("xiaoyu-ffmpeg-" + [guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $temporaryDirectory 'ffmpeg-release-essentials.zip'
$checksumPath = Join-Path $temporaryDirectory 'ffmpeg-release-essentials.zip.sha256'
$extractDirectory = Join-Path $temporaryDirectory 'extracted'

try {
    New-Item -ItemType Directory -Path $temporaryDirectory -Force | Out-Null
    Write-Host 'Downloading FFmpeg Essentials...'
    Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath -UseBasicParsing
    Invoke-WebRequest -Uri $checksumUrl -OutFile $checksumPath -UseBasicParsing

    $checksumText = (Get-Content -Raw -LiteralPath $checksumPath).Trim()
    $expectedHashMatch = [regex]::Match($checksumText, '(?i)\b[a-f0-9]{64}\b')
    if (-not $expectedHashMatch.Success) {
        throw 'The official FFmpeg checksum response is invalid.'
    }

    $expectedHash = $expectedHashMatch.Value.ToUpperInvariant()
    $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToUpperInvariant()
    if ($actualHash -ne $expectedHash) {
        throw 'FFmpeg checksum verification failed.'
    }

    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDirectory -Force
    $downloadedBinary = Get-ChildItem -LiteralPath $extractDirectory -Recurse -File -Filter 'ffmpeg.exe' |
        Select-Object -First 1
    if ($null -eq $downloadedBinary) {
        throw 'The downloaded package does not contain ffmpeg.exe.'
    }

    New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
    Copy-Item -LiteralPath $downloadedBinary.FullName -Destination $targetPath -Force
    Write-Host 'FFmpeg download and verification completed.'
}
finally {
    if (Test-Path -LiteralPath $temporaryDirectory) {
        Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
    }
}
