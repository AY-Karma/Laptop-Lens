param([string]$PythonPath = '.venv/Scripts/python.exe')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
    $bundle = Join-Path $root 'release/Laptop Lens'
    $exe = Join-Path $bundle 'Laptop Lens.exe'
    if (-not (Test-Path -LiteralPath $exe)) { throw 'Build the desktop bundle first.' }
    if ((Get-Item -LiteralPath $exe).VersionInfo.ProductVersion -ne $version) { throw 'EXE version does not match package.json.' }
    foreach ($name in @('LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md')) {
        Copy-Item -LiteralPath (Join-Path $root $name) -Destination $bundle -Force
    }
    $previousMode = $env:LAPTOP_LENS_ONEFILE
    try {
        $env:LAPTOP_LENS_ONEFILE = '1'
        $python = (Get-Command $PythonPath -ErrorAction Stop).Source
        $build = Start-Process -FilePath $python -ArgumentList '-m PyInstaller --noconfirm --distpath release --workpath build-desktop "Laptop Lens.spec"' -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput 'build-desktop/standalone-build.log' -RedirectStandardError 'build-desktop/standalone-build-errors.log'
        if ($build.ExitCode -ne 0) { throw 'Standalone EXE build failed. See build-desktop/standalone-build-errors.log.' }
    } finally { $env:LAPTOP_LENS_ONEFILE = $previousMode }
    $zip = "release/Laptop-Lens-$version-Windows-x64.zip"
    Compress-Archive -LiteralPath $bundle -DestinationPath $zip -CompressionLevel Optimal -Force
    $assets = @("release/Laptop-Lens-$version-Windows-x64.exe", $zip)
    $checksums = foreach ($asset in $assets) {
        $hash = Get-FileHash -LiteralPath $asset -Algorithm SHA256
        '{0}  {1}' -f $hash.Hash.ToLowerInvariant(), (Split-Path -Leaf $asset)
    }
    $checksums | Set-Content -LiteralPath 'release/SHA256SUMS.txt' -Encoding ascii
    Write-Output "Release $version packaged with SHA-256 checksums."
} finally { Pop-Location }
