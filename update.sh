#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "Building frontend..."
nix-shell --run "cd frontend && npm run build"

echo "Restarting backend..."
sudo systemctl restart papol

echo "Done! Papol updated."
