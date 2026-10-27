# Switch to a staged candidate (or back to a previous release) without resetting mappings.
# Run with waxyct quit. User edits are retained and new defaults go to .updates/incoming.
# No release directory is deleted. Set -ReleasesDir for an external release library.
param(
  [string]$Version = '3.1.0-alpha.8-codex.1',
  [string]$Previous = '3.1.0-alpha.7',
  [string]$ReleasesDir = (Join-Path $PSScriptRoot '..\release'),
  [string]$ConfigDir = "$env:APPDATA\waxyct\config",
  [switch]$Rollback,
  [switch]$SkipShortcuts
)
$ErrorActionPreference = 'Stop'
if (Get-Process waxyct -ErrorAction SilentlyContinue) { throw 'waxyct is running. Quit it from its tray menu, then try again.' }
$targetVersion = if ($Rollback) { $Previous } else { $Version }
if ($targetVersion -notmatch '^[0-9A-Za-z][0-9A-Za-z.+-]*$') { throw 'Version must be a release version, not a path.' }
$release = Join-Path $ReleasesDir "waxyct.$targetVersion"
$exe = Join-Path $release 'waxyct.exe'
$ship = Join-Path $release 'resources\app\config'
if (-not (Test-Path -LiteralPath $exe) -or -not (Test-Path -LiteralPath $ship)) { throw "No staged release at $release" }
# The same ownership rules as packaged startup: baseline-equal files update, edits
# and files without provenance stay. This also makes rollback preserve later edits.
& node (Join-Path $PSScriptRoot 'upgrade-config.mjs') $ship $ConfigDir $targetVersion
if ($LASTEXITCODE -ne 0) { throw 'Configuration reconciliation failed; shortcuts were not changed.' }
if (-not $SkipShortcuts) {
  $links = @("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\waxyct.lnk", "$([Environment]::GetFolderPath('Desktop'))\waxyct.lnk")
  $sh = New-Object -ComObject WScript.Shell
  foreach ($l in $links) {
    if (Test-Path -LiteralPath $l) {
      $s = $sh.CreateShortcut($l)
      $s.TargetPath = [IO.Path]::GetFullPath($exe)
      $s.WorkingDirectory = [IO.Path]::GetFullPath($release)
      $s.IconLocation = "$($s.TargetPath),0"
      $s.Save()
      "shortcut $l -> $($s.TargetPath)"
    }
  }
}
"Selected $targetVersion. User mappings were preserved; inspect $ConfigDir\.updates\report.json for details."
