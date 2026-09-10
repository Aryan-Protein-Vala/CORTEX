# Wire the CORTEX MCP server into Cursor and/or Claude Desktop on Windows.
#
# PowerShell twin of ./setup-cursor-mcp.sh: merges into an existing config, keeps
# a timestamped backup, is idempotent, and can undo itself. Never touches the
# registry, never needs an elevated shell.
#
#   .\setup-cursor-mcp.ps1
#   .\setup-cursor-mcp.ps1 -Cursor
#   .\setup-cursor-mcp.ps1 -Claude
#   .\setup-cursor-mcp.ps1 -DryRun
#   .\setup-cursor-mcp.ps1 -Remove
#
# If script execution is blocked in your shell:
#   powershell -ExecutionPolicy Bypass -File .\setup-cursor-mcp.ps1

[CmdletBinding()]
param(
    [switch]$Cursor,
    [switch]$Claude,
    [switch]$DryRun,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$McpEntry = Join-Path $RootDir 'cortex-mcp\index.js'
$ApiUrl = if ($env:CORTEX_API_URL) { $env:CORTEX_API_URL } else { 'http://127.0.0.1:3030' }
$Owner = if ($env:CORTEX_OWNER) { $env:CORTEX_OWNER } else { 'cortex://default' }
if (-not $Cursor -and -not $Claude) { $Cursor = $true; $Claude = $true }

function Test-Command([string]$name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

if (-not (Test-Command 'node')) {
    Write-Error 'node is required (the MCP server is a Node program). Install Node 18+ and re-run.'
    exit 1
}

function Update-McpConfig {
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][string]$Dir,
        [Parameter(Mandatory)][string]$File,
        # A project-level .cursor/mcp.json is the point of the installer, so the
        # directory is created if absent. App-level configs are only touched when
        # the app has been run at least once.
        [switch]$ForceDir
    )

    if (-not (Test-Path $Dir) -and -not $ForceDir -and -not $Remove) {
        Write-Host "==> ${Label}: no ${Dir}, skipping (create it if you do use ${Label})"
        return
    }

    Write-Host "==> $Label"
    if ($DryRun) {
        $verb = if ($Remove) { 'remove' } else { 'add' }
        Write-Host "    (dry run) would $verb the cortex entry in $File"
        return
    }

    $config = $null
    $existed = $false
    if (Test-Path $File) {
        $existed = $true
        try {
            # PS 5.1's ConvertFrom-Json returns a PSCustomObject; reparse into
            # something we can safely mutate and re-serialize.
            $raw = Get-Content -Raw -Path $File
            $config = $raw | ConvertFrom-Json
            if ($null -eq $config) { throw 'empty document' }
        } catch {
            Write-Host "  REFUSING to touch ${File}: could not parse ($($_.Exception.Message))"
            Write-Host '  Fix the JSON by hand, or point the editor config elsewhere.'
            exit 3
        }
    } else {
        New-Item -ItemType Directory -Force -Path $Dir | Out-Null
        $config = [pscustomobject]@{}
    }

    if (-not $config.PSObject.Properties['mcpServers']) {
        $config | Add-Member -MemberType NoteProperty -Name mcpServers -Value ([pscustomobject]@{})
    }
    $servers = $config.mcpServers

    if ($Remove) {
        if ($servers.PSObject.Properties['cortex']) {
            $servers.PSObject.Properties.Remove('cortex')
        } else {
            Write-Host '  nothing to remove'
            return
        }
    } else {
        $envBlock = [ordered]@{
            CORTEX_API_URL = $ApiUrl
            CORTEX_OWNER   = $Owner
        }
        if ($env:CORTEX_API_KEY) { $envBlock['CORTEX_API_KEY'] = $env:CORTEX_API_KEY }
        $entry = [ordered]@{
            command = 'node'
            args    = @($McpEntry)
            env     = $envBlock
        }
        $current = $servers.PSObject.Properties['cortex']
        if ($current) {
            $sameArgs = ($current.Value.args -join '|') -eq ($entry.args -join '|')
            $sameUrl = $current.Value.env.CORTEX_API_URL -eq $ApiUrl
            if ($sameArgs -and $sameUrl) {
                Write-Host '  already configured, leaving it untouched'
                return
            }
        }
        $others = @($servers.PSObject.Properties.Name | Where-Object { $_ -ne 'cortex' })
        if ($others.Count -gt 0) {
            Write-Host "  merging alongside $($others.Count) existing server(s): $($others -join ', ')"
        }
        if ($servers.PSObject.Properties['cortex']) {
            $servers.PSObject.Properties.Remove('cortex')
        }
        $servers | Add-Member -MemberType NoteProperty -Name cortex -Value ($entry | ConvertTo-Json -Depth 10 | ConvertFrom-Json)
    }

    if ($existed) {
        $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
        $backup = "$File.cortex-backup-$stamp"
        Copy-Item -Path $File -Destination $backup -Force
        Write-Host "  backup: $(Split-Path -Leaf $backup)"
    }

    $json = $config | ConvertTo-Json -Depth 20
    # UTF8 without a BOM: a leading BOM makes some editors reject the file outright.
    [System.IO.File]::WriteAllText($File, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "  wrote $File"
}

if (-not $Remove) {
    if (-not (Test-Path $McpEntry)) {
        Write-Error "missing $McpEntry - run this from a full clone of the repo."
        exit 1
    }
    Write-Host '==> installing MCP server dependencies'
    if (-not (Test-Path (Join-Path $RootDir 'cortex-mcp\node_modules'))) {
        if ($DryRun) {
            Write-Host '    (dry run) cd cortex-mcp; npm install --omit=dev'
        } else {
            Push-Location (Join-Path $RootDir 'cortex-mcp')
            try {
                & npm install --omit=dev --no-audit --no-fund | Out-Null
                Write-Host '    installed'
            } finally {
                Pop-Location
            }
        }
    } else {
        Write-Host '    already present, skipping'
    }
}

$appData = if ($env:APPDATA) { $env:APPDATA } else { Join-Path $HOME 'AppData\Roaming' }
if ($Cursor) {
    Update-McpConfig -Label 'Cursor (project)' -Dir (Join-Path $RootDir '.cursor') -File (Join-Path $RootDir '.cursor\mcp.json') -ForceDir
}
if ($Claude) {
    Update-McpConfig -Label 'Claude Desktop' -Dir (Join-Path $appData 'Claude') -File (Join-Path $appData 'Claude\claude_desktop_config.json')
}

if ($Remove) {
    Write-Host 'done: the cortex entry was removed (backups kept next to each config).'
    exit 0
}

Write-Host ''
Write-Host 'done. Restart Cursor / Claude Desktop so the new server is picked up.'
Write-Host 'Memory lives in your own core, which must be running:'
Write-Host ''
Write-Host '  cd "$RootDir\cortex-core"; cargo run --release --bin cortex-core'
Write-Host ''
Write-Host "Config used: CORTEX_API_URL=$ApiUrl CORTEX_OWNER=$Owner key $(if ($env:CORTEX_API_KEY) { 'set' } else { 'not set' })"
Write-Host 'Verify the wiring with:  cd cortex-mcp; npm run smoke'
