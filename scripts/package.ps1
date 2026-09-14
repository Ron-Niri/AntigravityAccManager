$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = Split-Path $PSScriptRoot -Parent
$manifest = Get-Content -Raw (Join-Path $projectRoot 'package.json') | ConvertFrom-Json
$destination = Join-Path $projectRoot "antigravity-account-manager-$($manifest.version).vsix"
$archive = [System.IO.Compression.ZipFile]::Open($destination, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in @('package.json', 'README.md')) {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $projectRoot $file), "extension/$file") | Out-Null
  }
  foreach ($folder in @('src', 'media')) {
    Get-ChildItem (Join-Path $projectRoot $folder) -File | ForEach-Object {
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, "extension/$folder/$($_.Name)") | Out-Null
    }
  }
  foreach ($name in @('[Content_Types].xml', 'extension.vsixmanifest')) {
    $source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot $name)
    $entry = $archive.CreateEntry($name)
    $writer = [System.IO.StreamWriter]::new($entry.Open())
    try { $writer.Write($source.Replace('{{version}}', $manifest.version)) } finally { $writer.Dispose() }
  }
} finally { $archive.Dispose() }
Write-Output $destination
