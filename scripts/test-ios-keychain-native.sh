#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test "$(uname -s)" = Darwin
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/dengta-keychain-policy.XXXXXX")"
trap 'rm -f "$test_dir/keychain-policy"; rmdir "$test_dir"' EXIT
xcrun --sdk macosx swiftc -framework Foundation -framework Security \
  ios/App/App/DengTaKeychainStore.swift ios/App/Tests/KeychainStore/main.swift \
  -o "$test_dir/keychain-policy"
"$test_dir/keychain-policy"
