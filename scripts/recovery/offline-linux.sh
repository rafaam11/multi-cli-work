#!/usr/bin/env bash
set -euo pipefail
# Called only by hosted CI through sudo unshare --net. Restore the runner UID
# before any controller, app or data write; only dpkg receives scoped elevation.
if [[ "$EUID" != 0 || "${GITHUB_ACTIONS:-}" != true || "${RUNNER_ENVIRONMENT:-}" != github-hosted || "${GITHUB_REPOSITORY:-}" != rafaam11/multi-cli-work || -z "${SUDO_UID:-}" || -z "${SUDO_GID:-}" ]]; then
  echo 'Disposable GitHub runner and a fresh network namespace are required' >&2
  exit 1
fi
if [[ "$(readlink /proc/self/ns/net)" == "$(readlink /proc/1/ns/net)" || "$(ip -o link show | wc -l)" != 1 ]]; then
  echo 'A separate network namespace containing only loopback is required' >&2
  exit 1
fi
ip link set lo up
export HOME="$(getent passwd "$SUDO_UID" | cut -d: -f6)"
export USER="$(getent passwd "$SUDO_UID" | cut -d: -f1)"
export LOGNAME="$USER"
export MCW_NETWORK_ISOLATED=1
exec setpriv --reuid "$SUDO_UID" --regid "$SUDO_GID" --init-groups "$@"
