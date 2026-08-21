#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "Building frontend..."
nix develop --command bash -c "cd frontend && npm run build"

echo "Building PDF viewer..."
nix develop --command bash -c "cd viewer && npm run build"

echo "Restarting backend..."
sudo systemctl restart papol

echo "Done! Papol updated."
