param(
    [string]$ApiKey = "",
    [string]$Model = "gpt-5.5"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$secretPath = Join-Path $root "secrets.env"

if ([string]::IsNullOrWhiteSpace($ApiKey)) {
    $secureKey = Read-Host "Paste your OpenAI API key for this computer" -AsSecureString
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    )
} else {
    $plainKey = $ApiKey
}

@(
    "OPENAI_API_KEY=$plainKey"
    "OPENAI_MODEL=$Model"
) | Set-Content -Path $secretPath -Encoding UTF8

Write-Host "Created local secrets.env. This file is ignored by Git and should not be uploaded."
Write-Host "Run .\start.ps1 to launch the DnD crawl projector."
