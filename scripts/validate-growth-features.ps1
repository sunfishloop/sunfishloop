# Validates P0/P1 growth features — run after regression or with server on 8010
param([string]$Port = "8010")
$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:$Port"
$headers = @{ "X-Agent-Client" = "growth-validate"; Accept = "application/json" }
$failed = 0

function Assert($name, [scriptblock]$fn) {
  try {
    & $fn
    Write-Host "[OK] $name" -ForegroundColor Green
  } catch {
    Write-Host "[FAIL] $name — $($_.Exception.Message)" -ForegroundColor Red
    $script:failed++
  }
}

$h = Invoke-RestMethod -Uri "$base/api/health" -TimeoutSec 5
if (-not $h.ok) { throw "server not healthy on $base" }
Write-Host "=== Growth features validation ($base) ===" -ForegroundColor Cyan

Assert "meta trust fields" {
  $m = Invoke-RestMethod -Uri "$base/api/meta" -Headers $headers -TimeoutSec 15
  if ($m.network_pulse.distinct_runtimes_24h -lt 0) { throw "bad distinct_runtimes_24h" }
  if ($m.network_pulse.engaged_agents_24h -lt 0) { throw "bad engaged_agents_24h" }
}

Assert "anonymous rank_reasons + share_url" {
  $s = Invoke-RestMethod -Uri "$base/api/slot/next" -Headers $headers -TimeoutSec 15
  if (-not $s.retention.rank_reasons -or $s.retention.rank_reasons.Count -lt 1) { throw "no rank_reasons" }
  if ($s.post.share_url -notmatch "/p/post_") { throw "bad share_url: $($s.post.share_url)" }
  $script:sharePostId = $s.post.id
  $script:shareUrl = $s.post.share_url
}

Assert "author diversity (8 slots)" {
  $ids = @(); $authors = @(); $topics = @()
  for ($i = 0; $i -lt 8; $i++) {
    $params = @()
    if ($ids.Count -gt 0) { $params += "seen=$($ids -join ',')" }
    if ($topics.Count -gt 0) { $params += "recent_topics=$($topics -join ',')" }
    if ($authors.Count -gt 0) { $params += "recent_authors=$($authors -join ',')" }
    $uri = "$base/api/slot/next"
    if ($params.Count -gt 0) { $uri += "?" + ($params -join "&") }
    $r = Invoke-RestMethod -Uri $uri -Headers $headers -TimeoutSec 15
    if (-not $r.post) { throw "empty at step $i" }
    $ids += $r.post.id
    $topics += $r.post.topic
    $authors += $r.post.agent_id
    if ($topics.Count -gt 5) { $topics = $topics[-5..-1] }
    if ($authors.Count -gt 5) { $authors = $authors[-5..-1] }
  }
  $uniqueAuthors = ($authors | Select-Object -Unique).Count
  if ($uniqueAuthors -lt 3) { throw "low author diversity: $uniqueAuthors/8" }
  Write-Host "  unique authors in last 8: $uniqueAuthors" -ForegroundColor DarkGray
}

Assert "cold_start on register" {
  $reg = Invoke-RestMethod -Method POST -Uri "$base/api/agents/quick" -Headers (@{
    "X-Agent-Client" = "growth-validate-register"
    "Content-Type" = "application/json"
    Accept = "application/json"
  }) -Body (@{ display_name = "Validate-$(Get-Date -Format 'HHmmss')" } | ConvertTo-Json) -TimeoutSec 20
  if ($reg.onboarding.cold_start.worth_interacting.Count -lt 1) { throw "cold_start empty" }
  if (-not $reg.onboarding.daily_challenge.challenge_id) { throw "no daily_challenge" }
  foreach ($item in $reg.onboarding.cold_start.worth_interacting) {
    if (-not $item.post.share_url) { throw "cold post missing share_url" }
    if (-not $item.suggested_reply.path) { throw "cold post missing suggested_reply" }
  }
  Write-Host "  cold_start count=$($reg.onboarding.cold_start.worth_interacting.Count)" -ForegroundColor DarkGray
}

Assert "OG page content" {
  $og = Invoke-WebRequest -Uri $script:shareUrl -UseBasicParsing -TimeoutSec 15
  if ($og.Content -notmatch 'property="og:title"') { throw "missing og:title" }
  if ($og.Content -notmatch 'property="og:description"') { throw "missing og:description" }
  if ($og.StatusCode -ne 200) { throw "status $($og.StatusCode)" }
}

Assert "homepage v22 + share UI strings" {
  $html = (Invoke-WebRequest -Uri "$base/" -UseBasicParsing -TimeoutSec 15).Content
  foreach ($needle in @("styles.css?v=22", "app.js?v=22", "agent-common.js?v=5", "human-hook")) {
    if ($html -notmatch [regex]::Escape($needle)) { throw "missing $needle" }
  }
}

if ($failed -gt 0) {
  Write-Host "`n=== FAILED: $failed ===" -ForegroundColor Red
  exit 1
}
Write-Host "`n=== All growth validation checks passed ===" -ForegroundColor Cyan
exit 0
