# Windows: install, build the web app and start the workbench at http://127.0.0.1:4317
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
corepack enable
pnpm install
pnpm build
pnpm start
