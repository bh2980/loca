$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath $PSScriptRoot
try {
  if (-not (Test-Path -LiteralPath 'node_modules')) { npm install; if ($LASTEXITCODE -ne 0) { throw '의존성 설치에 실패했습니다.' } }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'UI 빌드에 실패했습니다.' }
  Write-Host 'Translation Workbench: http://127.0.0.1:4317'
  npm start
} finally { Pop-Location }
