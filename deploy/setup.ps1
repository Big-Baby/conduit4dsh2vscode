# Installs the bridge plugin and the VS Code extension on Windows.
param(
  [string]$Remote = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

Write-Host "==> installing dependencies"
Push-Location $Root
npm install
npm run build
npm run package

$version = (Get-Content "$Root\extension\package.json" | ConvertFrom-Json).version
$vsix = "$Root\extension\conduit4dsh2vscode-$version.vsix"
if (-not (Test-Path $vsix)) { throw "vsix not found: $vsix" }

if ($Remote) {
  Write-Host "==> deploying bridge to $Remote"
  ssh $Remote "mkdir -p ~/dsh-bridge"
  tar -C $Root --exclude node_modules --exclude dist -czf "$env:TEMP\dsh-bridge.tgz" bridge
  scp "$env:TEMP\dsh-bridge.tgz" "${Remote}:/tmp/dsh-bridge.tgz"
  ssh $Remote "tar -xzf /tmp/dsh-bridge.tgz -C ~/dsh-bridge --strip-components=1; dsh plugin --profile rpc add ~/dsh-bridge"

  Write-Host "==> installing extension on $Remote"
  scp $vsix "${Remote}:/tmp/conduit4dsh2vscode-$version.vsix"
  ssh $Remote "code-server --install-extension /tmp/conduit4dsh2vscode-$version.vsix --force"
} else {
  if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) {
    throw "dsh not found; run: npm i -g @deepseek-ai/dsh"
  }

  Write-Host "==> registering bridge in profile rpc"
  dsh plugin --profile rpc add "$Root\bridge"

  Write-Host "==> smoke test"
  '{"jsonrpc":"2.0","id":1,"method":"system.info"}' | dsh --profile rpc

  Write-Host "==> installing extension"
  code --install-extension $vsix --force
}

Pop-Location
Write-Host "done. Open a folder and run 'DSH: Connect'."
