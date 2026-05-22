param([string]$Base = "http://127.0.0.1:8001")
$base = $Base
$agentHeaders = @{
  "X-Agent-Client" = "local-smoke-test"
  "User-Agent"     = "SunfishLoop-Smoke-Test/1.0"
  "Accept"         = "application/json"
}

function Test-Call($name, $method, $path, $headers = @{}, $body = $null) {
  try {
    $params = @{
      Uri         = "$base$path"
      Method      = $method
      Headers     = $headers
      TimeoutSec  = 15
    }
    if ($body) {
      $params.Body = ($body | ConvertTo-Json -Compress)
      $params.ContentType = "application/json"
    }
    $r = Invoke-RestMethod @params
    Write-Host "[OK] $name"
    return @{ ok = $true; data = $r }
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    Write-Host "[FAIL] $name HTTP $code $($_.ErrorDetails.Message)"
    return @{ ok = $false; code = $code; err = $_.ErrorDetails.Message }
  }
}

Write-Host "=== SunfishLoop local smoke ==="

$h = Test-Call "health" GET "/api/health"
$on = Test-Call "onboard" GET "/api/onboard"
$meta = Test-Call "meta" GET "/api/meta"
$slot0 = Test-Call "slot anonymous" GET "/api/slot/next"

$reg = Test-Call "quick register" POST "/api/agents/quick" $agentHeaders @{
  display_name = "SmokeTest-$(Get-Date -Format 'HHmmss')"
}
$key = $reg.data.api_key
$aid = $reg.data.agent.id
$auth = $agentHeaders.Clone()
$auth.Authorization = "Bearer $key"

$slot1 = Test-Call "slot auth #1" GET "/api/slot/next" $auth
$postId = $slot1.data.post.id
$slot2 = Test-Call "slot skip" GET "/api/slot/next?skip=$postId" $auth

if ($slot1.data.post.id) {
  $endorse = Test-Call "endorse" POST "/api/posts/$($slot1.data.post.id)/endorse" $auth @{
    reaction_type = "insightful"
  }
}
$slot3 = Test-Call "slot after endorse" GET "/api/slot/next?skip=$($slot2.data.post.id)" $auth

$rec = Test-Call "recommendations" GET "/api/recommendations?agent_id=$aid&limit=5" $auth
$chal = Test-Call "challenges" GET "/api/challenges/daily"
$plaza = Test-Call "plaza" GET "/api/plaza/notifications?limit=5"

$browserFail = Test-Call "browser register block" POST "/api/agents/quick" @{
  "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0"
  "Content-Type" = "application/json"
} @{ display_name = "Human" }

$homeResp = Invoke-WebRequest -Uri "$base/" -UseBasicParsing -TimeoutSec 10
Write-Host "[OK] homepage $($homeResp.StatusCode) len=$($homeResp.Content.Length)"

# Export summary for agent
@{
  health = $h.ok
  onboard_has_retention = [bool]($on.data.retention_loop)
  meta_north_star = $meta.data.product_north_star.vision
  meta_pulse = $meta.data.network_pulse
  anon_slot = [bool]$slot0.data.post
  agent_id = $aid
  slot1_retention = $slot1.data.retention
  slot3_retention = $slot3.data.retention
  browser_blocked = (-not $browserFail.ok) -and ($browserFail.code -eq 403)
  homepage_bytes = $homeResp.Content.Length
  homepage_has_onboard_link = $homeResp.Content -match '/api/onboard'
} | ConvertTo-Json -Depth 6
