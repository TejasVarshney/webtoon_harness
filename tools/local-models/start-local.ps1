<#
.SYNOPSIS
  Starts the app in a sandbox wired to local models: gemma4 on Ollama (agent) and the SDXL webtoon bridge (images).

.DESCRIPTION
  1. Makes sure Ollama answers and the gemma4-webtoon model tag exists (creates it from the Modelfile if not).
  2. Starts the image bridge (InfiniteWebtoons SDXL + IP-Adapter + LoRA) in its own window and waits until it is ready.
  3. Seeds .local-env\user-data\models.json (only the first time, or with -Reseed).
  4. Runs `npm run dev` with WEBTOON_USER_DATA / WEBTOON_PROJECTS_ROOT pointing at .local-env, so your normal
     app data and projects are never touched.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\local-models\start-local.ps1
  powershell -ExecutionPolicy Bypass -File tools\local-models\start-local.ps1 -Vision -Reseed
#>
param(
  [switch]$Vision,            # mark gemma4 vision-capable + assign the vision role (needs a working Ollama vision encoder)
  [switch]$Reseed,            # overwrite .local-env\user-data\models.json
  [switch]$NoImageServer,     # do not start the bridge (e.g. it already runs)
  [string]$InfiniteRoot = 'E:\claude\InfiniteWebtoons',
  [string]$Offload = 'sequential',
  [double]$Scale = 0.75,
  [int]$Steps = 20,
  [int]$ImagePort = 7861
)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$envDir = Join-Path $repo '.local-env'
$userData = Join-Path $envDir 'user-data'
$projects = Join-Path $envDir 'projects'
New-Item -ItemType Directory -Force $userData, $projects | Out-Null

Write-Host '== Ollama'
try { Invoke-RestMethod -TimeoutSec 10 http://localhost:11434/api/version | Out-Null }
catch { throw 'Ollama is not answering on http://localhost:11434 - start the Ollama app first.' }
$tags = (Invoke-RestMethod -TimeoutSec 30 http://localhost:11434/api/tags).models.name
if (-not ($tags -contains 'gemma4-webtoon:latest')) {
  Write-Host 'creating gemma4-webtoon (gemma4:e4b with a 16k context)'
  ollama create gemma4-webtoon -f (Join-Path $PSScriptRoot 'gemma4-webtoon.Modelfile')
}

if (-not $NoImageServer) {
  Write-Host '== SDXL image bridge'
  $log = Join-Path $envDir 'image-server.log'
  $server = Join-Path $PSScriptRoot 'image_server.py'
  $cmd = "uv run --project `"$InfiniteRoot`" python `"$server`" --port $ImagePort --offload $Offload --scale $Scale --steps $Steps 2>&1 | Tee-Object -FilePath `"$log`""
  Start-Process powershell -ArgumentList '-NoExit', '-Command', $cmd -WindowStyle Normal | Out-Null
  $deadline = (Get-Date).AddMinutes(6)
  do {
    Start-Sleep -Seconds 3
    try { $h = Invoke-RestMethod -TimeoutSec 3 "http://127.0.0.1:$ImagePort/health" } catch { $h = $null }
    if ($h -and $h.status -eq 'error') { throw "image bridge failed to load: $($h.error) (see $log)" }
  } until (($h -and $h.status -eq 'ready') -or (Get-Date) -gt $deadline)
  if (-not $h -or $h.status -ne 'ready') { throw "image bridge not ready after 6 minutes (see $log)" }
  Write-Host "bridge ready on http://127.0.0.1:$ImagePort/v1"
}

Write-Host '== models.json'
$seedArgs = @('tools/local-models/seed-models.mjs', '--user-data', $userData)
if ($Vision) { $seedArgs += '--vision' }
if ($Reseed) { $seedArgs += '--force' }
$env:IMAGE_URL = "http://127.0.0.1:$ImagePort"
Push-Location $repo
try {
  node @seedArgs
  Write-Host '== app (sandbox data in .local-env)'
  $env:WEBTOON_USER_DATA = $userData
  $env:WEBTOON_PROJECTS_ROOT = $projects
  Remove-Item Env:WEBTOON_MOCK_SCRIPT -ErrorAction SilentlyContinue
  npm run dev
}
finally { Pop-Location }
