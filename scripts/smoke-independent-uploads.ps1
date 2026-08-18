param(
  [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"
$workerName = "reftone-worker-1"
$cookieJar = [IO.Path]::GetTempFileName()
$imagePath = [IO.Path]::ChangeExtension([IO.Path]::GetTempFileName(), ".png")
$png = [Convert]::FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
[IO.File]::WriteAllBytes($imagePath, $png)
$workerWasRunning = (docker inspect $workerName --format "{{.State.Running}}") -eq "true"
$activeTaskId = $null
$script:uploadGeneration = 0

function Invoke-JsonCurl([string[]]$Arguments) {
  $text = & curl.exe -sS @Arguments
  if ($LASTEXITCODE -ne 0) { throw "curl failed with exit code $LASTEXITCODE" }
  return $text | ConvertFrom-Json
}

function Start-Upload([string]$TaskId, [string]$Role) {
  $script:uploadGeneration += 1
  $attempt = Invoke-JsonCurl @("-b", $cookieJar, "-H", "X-Upload-Generation: $script:uploadGeneration", "-X", "POST", "$BaseUrl/api/tasks/$TaskId/assets/$Role/attempts")
  if (-not $attempt.attemptId) { throw "Could not create $Role upload attempt" }
  $upload = Invoke-JsonCurl @(
    "-b", $cookieJar, "-X", "PUT", "-F", "file=@$imagePath;type=image/png",
    "$BaseUrl/api/tasks/$TaskId/assets/$Role/attempts/$($attempt.attemptId)"
  )
  if (-not $upload.status) { throw "$Role upload did not return a task status" }
  return $upload
}

try {
  if ($workerWasRunning) { docker stop $workerName | Out-Null }
  $task = Invoke-JsonCurl @("-c", $cookieJar, "-X", "POST", "$BaseUrl/api/tasks")
  $activeTaskId = $task.id
  if ($task.status -ne "collecting") { throw "New task must be collecting" }

  $reference = Start-Upload $task.id "reference"
  if ($reference.status -ne "collecting") { throw "First upload must keep the task collecting" }
  $target = Start-Upload $task.id "target"
  if ($target.status -ne "queued") { throw "Second upload must queue the task" }

  $snapshot = Invoke-JsonCurl @("-b", $cookieJar, "$BaseUrl/api/tasks/$($task.id)")
  if ($snapshot.status -ne "queued" -or $snapshot.assets.reference.status -ne "confirmed" -or $snapshot.assets.target.status -ne "confirmed") {
    throw "A/B assets were not independently confirmed"
  }

  $replacement = Invoke-JsonCurl @(
    "-b", $cookieJar, "-H", "Content-Type: application/json", "-d", '{"replaceRole":"reference"}',
    "$BaseUrl/api/tasks/$($task.id)/replacement"
  )
  if (-not $replacement.id) { throw "Replacement task was not created" }
  $activeTaskId = $replacement.id
  $replacementSnapshot = Invoke-JsonCurl @("-b", $cookieJar, "$BaseUrl/api/tasks/$($replacement.id)")
  if ($replacementSnapshot.status -ne "collecting" -or $replacementSnapshot.assets.target.status -ne "confirmed" -or $replacementSnapshot.assets.reference.status -ne "empty") {
    throw "Replacement task did not retain only target B"
  }

  $replacementUpload = Start-Upload $replacement.id "reference"
  if ($replacementUpload.status -ne "queued") { throw "Replacement upload did not requeue the task" }
  Write-Output "Independent upload and single-side replacement smoke test passed."
} finally {
  if ($activeTaskId) {
    try { Invoke-JsonCurl @("-b", $cookieJar, "-X", "DELETE", "$BaseUrl/api/tasks/$activeTaskId") | Out-Null } catch { }
  }
  if ($workerWasRunning) { docker start $workerName | Out-Null }
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  foreach ($path in @($cookieJar, $imagePath)) {
    $resolved = [IO.Path]::GetFullPath($path)
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $resolved -Force -ErrorAction SilentlyContinue }
  }
}
