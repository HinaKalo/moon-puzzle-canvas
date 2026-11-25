param(
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$port = 18847
$url = "http://127.0.0.1:$port"

function Test-MoonCanvas {
    try {
        $health = Invoke-RestMethod -Uri "$url/healthz" -TimeoutSec 1 -NoProxy
        return $health.service -eq 'moon-puzzle-canvas' -and $health.status -eq 'ok'
    } catch {
        return $false
    }
}

if (-not (Test-MoonCanvas)) {
    $ssh = (Get-Command ssh.exe).Source
    $tunnel = Start-Process -FilePath $ssh -WindowStyle Hidden -PassThru -ArgumentList @(
        '-NT', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'ExitOnForwardFailure=yes',
        '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
        '-L', "127.0.0.1:${port}:127.0.0.1:${port}", 'moon'
    )
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 300
        if (Test-MoonCanvas) { $ready = $true; break }
        if ($tunnel.HasExited) { break }
    }
    if (-not $ready) {
        if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id }
        throw 'Could not open Moon canvas. Check SSH access to moon and local port 18847.'
    }
}
if (-not $NoBrowser) { Start-Process $url }
Write-Output $url
