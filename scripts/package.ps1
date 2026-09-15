$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
  npm run package
  if ($LASTEXITCODE -ne 0) { throw 'Extension packaging failed.' }
} finally { Pop-Location }
