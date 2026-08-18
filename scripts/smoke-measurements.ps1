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
  if ($upload.status -ne "collecting") { throw "$Role upload must keep the task collecting" }
}

try {
  if ($workerWasRunning) { docker stop $workerName | Out-Null }
  $task = Invoke-JsonCurl @("-c", $cookieJar, "-X", "POST", "$BaseUrl/api/tasks")
  $activeTaskId = $task.id
  Start-Upload $task.id "reference"
  Start-Upload $task.id "target"

  $confirmation = Invoke-JsonCurl @("-b", $cookieJar, "-X", "POST", "$BaseUrl/api/tasks/$($task.id)/analysis")
  if ($confirmation.status -ne "queued") { throw "Analysis confirmation did not queue the task" }

  docker-compose run --rm -T --no-deps -e DASHSCOPE_API_KEY= -e "SMOKE_TASK_ID=$($task.id)" worker `
    python -c "import os; from app.main import Worker, WorkerJob; Worker().process_analysis(WorkerJob(kind='analyze', task_id=os.environ['SMOKE_TASK_ID']))"
  if ($LASTEXITCODE -ne 0) { throw "One-shot measurement worker failed" }

  $snapshot = Invoke-JsonCurl @("-b", $cookieJar, "$BaseUrl/api/tasks/$($task.id)")
  if ($snapshot.status -ne "vision_failed" -or $snapshot.errorCode -ne "dashscope_api_key_missing") {
    throw "Measurement smoke task did not stop safely before Qwen"
  }
  if ($snapshot.measurements.schemaVersion -ne 1 -or -not $snapshot.measurements.reference -or -not $snapshot.measurements.target -or -not $snapshot.measurements.comparison) {
    throw "Task API did not return complete deterministic measurements"
  }
  Write-Output "Deterministic measurement smoke test passed without calling Qwen."
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
