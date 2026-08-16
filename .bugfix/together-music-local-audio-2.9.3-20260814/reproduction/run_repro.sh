#!/usr/bin/env bash
set +e
"/c/Program Files/nodejs/node.exe" "E:/chatgpt/dengta-home-frontend/.bugfix/together-music-local-audio-2.9.3-20260814/reproduction/refresh-freeze.repro.test.js" > "E:/chatgpt/dengta-home-frontend/.bugfix/together-music-local-audio-2.9.3-20260814/reproduction/stdout.txt" 2> "E:/chatgpt/dengta-home-frontend/.bugfix/together-music-local-audio-2.9.3-20260814/reproduction/stderr.txt"
status=$?
printf '%s' "$status" > "E:/chatgpt/dengta-home-frontend/.bugfix/together-music-local-audio-2.9.3-20260814/reproduction/exit_code.txt"
"/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe" -NoProfile -Command "Get-Content -Raw 'E:\chatgpt\dengta-home-frontend\.bugfix\together-music-local-audio-2.9.3-20260814\reproduction\stdout.txt'"
"/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe" -NoProfile -Command "Get-Content -Raw 'E:\chatgpt\dengta-home-frontend\.bugfix\together-music-local-audio-2.9.3-20260814\reproduction\stderr.txt'" >&2
exit "$status"
