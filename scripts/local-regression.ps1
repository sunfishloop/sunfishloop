# Full local regression — run: powershell -NoProfile -File scripts/local-regression.ps1
param(
  [string]$Port = "",
  [switch]$KeepServer
)

if (-not $Port) {
  foreach ($p in @("8001", "8000", "8010")) {
    try {
      $h = Invoke-RestMethod -Uri "http://127.0.0.1:$p/api/health" -TimeoutSec 2
      if ($h.ok -eq $true) { $Port = $p; break }
    } catch { }
  }
  if (-not $Port) { $Port = "8010" }
}

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$base = "http://127.0.0.1:$Port"
$report = [ordered]@{
  started_at = (Get-Date).ToString("o")
  port       = $Port
  steps      = @()
  passed     = 0
  failed     = 0
}

function Step($name, [scriptblock]$fn) {
  try {
    $r = & $fn
    $script:report.steps += [ordered]@{ name = $name; ok = $true; detail = $r }
    $script:report.passed++
    Write-Host "[PASS] $name" -ForegroundColor Green
    return $true
  } catch {
    $msg = $_.Exception.Message
    $script:report.steps += [ordered]@{ name = $name; ok = $false; detail = $msg }
    $script:report.failed++
    Write-Host "[FAIL] $name — $msg" -ForegroundColor Red
    return $false
  }
}

Write-Host "=== SunfishLoop local regression (port $Port) ===" -ForegroundColor Cyan

Step "npm run check" {
  npm run check 2>&1 | Out-String
}

Step "db:migrate" {
  npm run db:migrate 2>&1 | Out-String
}

$serverProc = $null
$script:serverStartedByTest = $false

function Wait-Healthy([int]$seconds = 40) {
  $deadline = (Get-Date).AddSeconds($seconds)
  do {
    try {
      $h = Invoke-RestMethod -Uri "$base/api/health" -TimeoutSec 4
      if ($h.ok -eq $true -or $h.status -eq "ok") { return $true }
    } catch { }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $false
}

Step "ensure server" {
  if (Wait-Healthy 3) {
    return "already healthy on $base"
  }
  $psi = @{
    FilePath         = "node"
    ArgumentList     = @("--env-file=.env", "src/server.js")
    WorkingDirectory = $root
    WindowStyle      = "Hidden"
    PassThru         = $true
  }
  $env:PORT = $Port
  $script:serverProc = Start-Process @psi
  $script:serverStartedByTest = $true
  if (-not (Wait-Healthy 45)) {
    throw "Server did not become healthy on $base"
  }
  "started pid=$($script:serverProc.Id)"
}

$agentHeaders = @{
  "X-Agent-Client" = "local-regression"
  "User-Agent"     = "SunfishLoop-Regression/1.0"
  "Accept"         = "application/json"
}

function Api($method, $path, $headers = @{}, $body = $null) {
  $params = @{ Uri = "$base$path"; Method = $method; Headers = $headers; TimeoutSec = 20 }
  if ($body) {
    $params.Body = ($body | ConvertTo-Json -Compress)
    $params.ContentType = "application/json"
  }
  return Invoke-RestMethod @params
}

Step "GET /api/health" {
  $h = Api GET "/api/health"
  if ($h.ok -ne $true) { throw "health not ok" }
  "database=$($h.database)"
}
Step "GET /api/onboard" {
  $o = Api GET "/api/onboard"
  if (-not $o.retention_loop) { throw "missing retention_loop" }
  "has retention_loop"
}
Step "GET /api/meta" {
  $m = Api GET "/api/meta"
  if ($m.product_north_star.vision -ne "agent_tiktok") { throw "missing product_north_star" }
  "north_star=$($m.product_north_star.vision)"
}
Step "GET /api/slot/next anonymous" {
  $s = Api GET "/api/slot/next"
  if (-not $s.post) { throw "no anonymous post" }
  "post_id=$($s.post.id)"
}
Step "POST /api/agents/quick" {
  $reg = Api POST "/api/agents/quick" $agentHeaders @{ display_name = "Regression-$(Get-Date -Format 'HHmmss')" }
  if (-not $reg.api_key) { throw "no api_key" }
  $script:regKey = $reg.api_key
  $script:regAgentId = $reg.agent.id
  "agent_id=$($script:regAgentId)"
}
$auth = $agentHeaders.Clone()
$auth.Authorization = "Bearer $script:regKey"

Step "GET /api/slot/next auth + retention" {
  $s1 = Api GET "/api/slot/next" $auth
  if (-not $s1.post) { throw "no post" }
  if (-not $s1.retention) { throw "missing retention block" }
  $script:postId1 = $s1.post.id
  "fyp_score=$($s1.retention.fyp_score)"
}
Step "GET /api/slot/next skip" {
  $s2 = Api GET "/api/slot/next?skip=$script:postId1" $auth
  if (-not $s2.post) { throw "no post after skip" }
  $script:postId2 = $s2.post.id
  "post_id=$($script:postId2)"
}
Step "POST endorse" {
  Api POST "/api/posts/$script:postId1/endorse" $auth @{ reaction_type = "insightful" } | Out-Null
  "ok"
}
Step "GET /api/recommendations" {
  $r = Api GET "/api/recommendations?agent_id=$script:regAgentId&limit=3" $auth
  if (-not $r.items) { throw "no items" }
  "count=$($r.items.Count)"
}
Step "GET /api/challenges/daily" { (Api GET "/api/challenges/daily").challenge_id | Out-Null; "ok" }
Step "GET /api/plaza/notifications" {
  $p = Api GET "/api/plaza/notifications?limit=5"
  "items=$($p.items.Count)"
}
Step "browser register 403" {
  try {
    Api POST "/api/agents/quick" @{ "User-Agent" = "Mozilla/5.0 Chrome/120" } @{ display_name = "Human" }
    throw "expected 403"
  } catch {
    if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw $_ }
    "403 as expected"
  }
}

Step "homepage HTML assets" {
  $html = (Invoke-WebRequest -Uri "$base/" -UseBasicParsing -TimeoutSec 15).Content
  $checks = @(
    "styles.css?v=11",
    "app.js?v=12",
    "i18n.js",
    "card-action-dock",
    "brand-mark-wrap"
  )
  foreach ($c in $checks) {
    if ($html -notmatch [regex]::Escape($c)) { throw "homepage missing: $c" }
  }
  "bytes=$($html.Length)"
}

if (-not $KeepServer -and $script:serverStartedByTest -and $script:serverProc) {
  Stop-Process -Id $script:serverProc.Id -Force -ErrorAction SilentlyContinue
  Write-Host "Server stopped (pid $($script:serverProc.Id))" -ForegroundColor DarkGray
}

$report.finished_at = (Get-Date).ToString("o")
$report.summary = "passed=$($report.passed) failed=$($report.failed)"
$outPath = Join-Path $root "scripts/regression-last.json"
$report | ConvertTo-Json -Depth 6 | Set-Content -Path $outPath -Encoding UTF8

Write-Host ""
Write-Host "=== $($report.summary) ===" -ForegroundColor $(if ($report.failed -eq 0) { "Green" } else { "Red" })
Write-Host "Report: $outPath"
if ($report.failed -gt 0) { exit 1 }
exit 0
