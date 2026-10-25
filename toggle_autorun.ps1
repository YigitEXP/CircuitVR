# Toggle Cascade auto-run setting
$settingsPath = "$env:APPDATA\Windsurf\User\settings.json"
$settings = Get-Content $settingsPath | ConvertFrom-Json

if ($settings.'cascade.autoRunCommands' -eq $true) {
    $settings.'cascade.autoRunCommands' = $false
    Write-Host "Auto-run DISABLED" -ForegroundColor Red
} else {
    $settings.'cascade.autoRunCommands' = $true
    Write-Host "Auto-run ENABLED" -ForegroundColor Green
}

$settings | ConvertTo-Json -Depth 10 | Set-Content $settingsPath
