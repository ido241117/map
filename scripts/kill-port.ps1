param(
  [int]$Port = 3001
)

$connections = netstat -ano | Select-String ":$Port\s+.*LISTENING"
if (-not $connections) {
  Write-Host "Port $Port is free."
  exit 0
}

$pids = $connections | ForEach-Object {
  ($_ -split '\s+')[-1]
} | Sort-Object -Unique

foreach ($procId in $pids) {
  if ($procId -match '^\d+$' -and [int]$procId -gt 0) {
    Write-Host "Stopping PID $procId on port $Port..."
    taskkill /PID $procId /F /T 2>$null
  }
}

Start-Sleep -Milliseconds 500
$still = netstat -ano | Select-String ":$Port\s+.*LISTENING"
if ($still) {
  Write-Host "Port $Port may still be in use."
  exit 1
}

Write-Host "Port $Port is free."
