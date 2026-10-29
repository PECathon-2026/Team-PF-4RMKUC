#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required. Install it from https://nodejs.org/"
  exit 1
fi
npm run check
npm test
npm run build
( sleep 1; if command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:3000; elif command -v open >/dev/null 2>&1; then open http://localhost:3000; fi ) >/dev/null 2>&1 &
npm run dev
