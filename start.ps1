$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$secretPath = Join-Path $root "secrets.env"

if (-not (Test-Path $secretPath)) {
    Write-Host "No secrets.env found. Starting setup first."
    & (Join-Path $root "setup.ps1")
}

$server = Start-Process -FilePath python -ArgumentList "server.py" -WorkingDirectory $root -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 1

Start-Process "http://127.0.0.1:8765/"
Start-Process "http://127.0.0.1:8765/?screen=projector"

Write-Host "DnD crawl system is running."
Write-Host "DM console:       http://127.0.0.1:8765/"
Write-Host "Projector view:   http://127.0.0.1:8765/?screen=projector"
Write-Host "Server process:   $($server.Id)"
Write-Host "Close this terminal or stop process $($server.Id) when finished."
