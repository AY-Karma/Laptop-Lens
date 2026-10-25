$ErrorActionPreference = 'Stop'
$bundle = Join-Path $PSScriptRoot 'release/Laptop Lens'
$sourceExe = Join-Path $bundle 'Laptop Lens.exe'
if (-not (Test-Path -LiteralPath $sourceExe)) {
    throw 'Build the desktop app first using Build Desktop.cmd.'
}
$destination = Join-Path $env:LOCALAPPDATA 'Programs/Laptop Lens'
$destinationExe = Join-Path $destination 'Laptop Lens.exe'
$running = Get-Process -Name 'Laptop Lens' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $destinationExe }
if ($running) { throw 'Close Laptop Lens before updating it.' }
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Get-ChildItem -LiteralPath $bundle -Force | Copy-Item -Destination $destination -Recurse -Force
$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Laptop Lens'
New-Item -ItemType Directory -Path $startMenu -Force | Out-Null
$shell = New-Object -ComObject WScript.Shell
foreach ($shortcutPath in @((Join-Path $desktop 'Laptop Lens.lnk'), (Join-Path $startMenu 'Laptop Lens.lnk'))) {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $destinationExe
    $shortcut.WorkingDirectory = $destination
    $iconPath = Join-Path $destination '_internal/assets/laptop-lens.ico'
    $shortcut.IconLocation = "$iconPath,0"
    $shortcut.Description = 'Private, live insight into your laptop.'
    $shortcut.Save()
}
Write-Output "Installed: $destinationExe"
Write-Output "Desktop shortcut: $(Join-Path $desktop 'Laptop Lens.lnk')"
