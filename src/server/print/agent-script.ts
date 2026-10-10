/**
 * The print agent for a Windows PC at the clinic: Windows PowerShell 5.1,
 * built into Windows 10/11, so nothing is installed. It reads
 * agent.conf (SERVER, TOKEN) next to itself, asks the server for ticket
 * jobs (long poll), writes their ESC/POS bytes to the printer's raw port
 * (9100) and reports the result. One instance per PC (a named mutex); the
 * config is re-read every round, so a reinstall with a new token takes
 * over without a restart. The installer (api/crm/print-agent/installer)
 * starts it hidden at every sign-in and fetches this script anew each
 * start, so a server deploy updates it.
 */
export const AGENT_SCRIPT = String.raw`# NeuroFax print agent (tickets to the receipt printer)
$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $dir 'agent.log'
function Log($m) {
  try {
    if ((Test-Path $log) -and ((Get-Item $log).Length -gt 1MB)) { Remove-Item $log -Force }
    Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $m)
  } catch {}
}
$mutex = New-Object System.Threading.Mutex($false, 'Local\NeuroFaxPrintAgent')
if (-not $mutex.WaitOne(0)) { exit }
Log 'started'
function ReadConf {
  $c = @{}
  foreach ($line in (Get-Content (Join-Path $dir 'agent.conf') -ErrorAction SilentlyContinue)) {
    $i = $line.IndexOf('=')
    if ($i -gt 0) { $c[$line.Substring(0, $i).Trim()] = $line.Substring($i + 1).Trim() }
  }
  return $c
}
function SendOnce([string]$printerHost, [int]$port, [byte[]]$bytes) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $wait = $client.BeginConnect($printerHost, $port, $null, $null)
    if (-not $wait.AsyncWaitHandle.WaitOne(4000)) { throw "printer $printerHost not answering" }
    $client.EndConnect($wait)
    $stream = $client.GetStream()
    $script:wrote = $true
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
    Start-Sleep -Milliseconds 300
  } finally { $client.Close() }
}
# A printer busy for a moment gets a second try before the CRM falls back
# to the browser, whose slip could come out late as a second one. Only when
# nothing was written yet: a half sent slip is not sent again.
function SendToPrinter([string]$printerHost, [int]$port, [byte[]]$bytes) {
  $script:wrote = $false
  try { SendOnce $printerHost $port $bytes }
  catch {
    if ($script:wrote) { throw }
    Log "retry: $($_.Exception.Message)"
    Start-Sleep -Milliseconds 1000
    SendOnce $printerHost $port $bytes
  }
}
while ($true) {
  $conf = ReadConf
  if (-not $conf.SERVER -or -not $conf.TOKEN) { Start-Sleep -Seconds 30; continue }
  $headers = @{ Authorization = "Bearer $($conf.TOKEN)" }
  try {
    $job = Invoke-RestMethod -UseBasicParsing -Uri "$($conf.SERVER)/api/print-agent/jobs" -Headers $headers -TimeoutSec 45
    if ($job -and $job.id) {
      $ok = $true; $err = $null
      try {
        SendToPrinter $job.host ([int]$job.port) ([Convert]::FromBase64String($job.data))
        Log "printed $($job.id)"
      } catch {
        $ok = $false; $err = $_.Exception.Message
        Log "failed $($job.id): $err"
      }
      $body = @{ ok = $ok; error = $err } | ConvertTo-Json -Compress
      try {
        Invoke-RestMethod -UseBasicParsing -Method Post -Uri "$($conf.SERVER)/api/print-agent/jobs/$($job.id)" -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 15 | Out-Null
      } catch { Log "report failed: $($_.Exception.Message)" }
    }
  } catch {
    $code = $null
    try { $code = [int]$_.Exception.Response.StatusCode } catch {}
    if ($code -eq 401) { Log 'token refused'; Start-Sleep -Seconds 30 }
    else { Log "server: $($_.Exception.Message)"; Start-Sleep -Seconds 5 }
  }
}
`;

/** The installer: a .bat the clinic's admin downloads and runs once on the PC. */
export function installerBat(args: { server: string; token: string }): string {
  const dir = "%ProgramData%\\NeuroFaxPrint";
  const script = `${args.server}/api/print-agent/agent.ps1`;
  // The start line: fetch the latest script (a deploy updates it), then run it.
  const ps =
    `[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; ` +
    `try { Invoke-WebRequest -UseBasicParsing '${script}' -OutFile '%DIR%\\agent.ps1' } catch {}; ` +
    // A bare &: this sits inside cmd's quoted region of the echo line (an
    // odd number of " before it), where & is literal and ^ would be copied
    // into start.vbs and break the PowerShell command (review 09.10.2026).
    `& '%DIR%\\agent.ps1'`;
  const lines = [
    "@echo off",
    "chcp 65001 >nul",
    "echo Ustanovka programmy pechati NeuroFax...",
    `set "DIR=${dir}"`,
    'if not exist "%DIR%" mkdir "%DIR%"',
    `> "%DIR%\\agent.conf" echo SERVER=${args.server}`,
    `>> "%DIR%\\agent.conf" echo TOKEN=${args.token}`,
    `curl.exe -fsSL "${script}" -o "%DIR%\\agent.ps1"`,
    "if errorlevel 1 goto fail",
    `> "%DIR%\\start.vbs" echo CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command ""${ps}""", 0, False`,
    // The user's Startup folder: starts at every sign-in, no admin rights needed.
    'copy /Y "%DIR%\\start.vbs" "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\NeuroFax Print.vbs" >nul',
    'wscript.exe "%DIR%\\start.vbs"',
    "echo.",
    "echo Gotovo: programma pechati zapushchena i budet zapuskatsya sama pri vkhode v Windows.",
    "pause",
    "exit /b 0",
    ":fail",
    "echo Ne udalos skachat programmu. Proverte internet i zapustite eshchyo raz.",
    "pause",
    "exit /b 1",
  ];
  return lines.join("\r\n") + "\r\n";
}
