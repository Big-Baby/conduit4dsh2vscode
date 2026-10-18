#!/usr/bin/env bash
# Installs the bridge plugin and the VS Code extension.
#
#   ./deploy/setup.sh                     # local machine
#   ./deploy/setup.sh --remote user@host  # Remote-SSH target
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote)
      REMOTE="${2:?--remote requires user@host}"
      shift 2
      ;;
    -h|--help)
      echo "usage: $0 [--remote user@host]"
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

command -v node >/dev/null || { echo "node is required" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required" >&2; exit 1; }

echo "==> installing dependencies"
(cd "$ROOT" && npm install)

echo "==> building"
(cd "$ROOT" && npm run build)
(cd "$ROOT" && npm run package)

VERSION="$(node -p "require('$ROOT/extension/package.json').version")"
VSIX="$ROOT/extension/conduit4dsh2vscode-$VERSION.vsix"
[[ -f "$VSIX" ]] || { echo "vsix not found: $VSIX" >&2; exit 1; }

if [[ -z "$REMOTE" ]]; then
  command -v dsh >/dev/null || { echo "dsh not found; run: npm i -g @deepseek-ai/dsh" >&2; exit 1; }

  echo "==> registering bridge in profile rpc"
  dsh plugin --profile rpc add "$ROOT/bridge" || echo "bridge already registered"

  echo "==> smoke test"
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"system.info"}' | dsh --profile rpc

  echo "==> installing extension"
  code --install-extension "$VSIX" --force
  echo "done. Open a folder and run 'DSH: Connect'."
  exit 0
fi

echo "==> deploying bridge to $REMOTE"
ssh "$REMOTE" 'mkdir -p ~/dsh-bridge'
tar -C "$ROOT" -czf - \
  --exclude node_modules \
  --exclude dist \
  bridge | ssh "$REMOTE" 'tar -xzf - -C ~/dsh-bridge --strip-components=1'

ssh "$REMOTE" "command -v dsh >/dev/null && dsh plugin --profile rpc add ~/dsh-bridge || echo 'dsh not found on the remote host'"

echo "==> installing extension on $REMOTE"
scp "$VSIX" "$REMOTE:/tmp/conduit4dsh2vscode-$VERSION.vsix"
ssh "$REMOTE" "code-server --install-extension /tmp/conduit4dsh2vscode-$VERSION.vsix --force || code --install-extension /tmp/conduit4dsh2vscode-$VERSION.vsix --force"

echo "done. Reconnect the Remote-SSH window and run 'DSH: Connect'."
