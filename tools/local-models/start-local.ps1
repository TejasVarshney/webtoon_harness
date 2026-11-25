<#
.SYNOPSIS
  Starts the app in a sandbox data folder (.local-env), so your normal app data and projects are never touched.

.DESCRIPTION
  Runs `npm run dev` with WEBTOON_USER_DATA / WEBTOON_PROJECTS_ROOT pointing at .local-env. It starts no model
  servers: the app uses whatever .local-env\user-data\models.json holds (the built-in mock on a fresh sandbox).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\local-models\start-local.ps1
#>
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$envDir = Join-Path $repo '.local-env'
$userData = Join-Path $envDir 'user-data'
$projects = Join-Path $envDir 'projects'
New-Item -ItemType Directory -Force $userData, $projects | Out-Null

Push-Location $repo
try {
  Write-Host '== app (sandbox data in .local-env)'
  $env:WEBTOON_USER_DATA = $userData
  $env:WEBTOON_PROJECTS_ROOT = $projects
  Remove-Item Env:WEBTOON_MOCK_SCRIPT -ErrorAction SilentlyContinue
  npm run dev
}
finally { Pop-Location }
