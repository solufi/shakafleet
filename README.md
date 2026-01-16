# Shaka Fleet

Fleet Manager (Next.js) + VM deployment assets.

## VM Deploy
See `deploy/vm/README.md`.

## GHCR
This repo publishes a Docker image to:
- `ghcr.io/solufi/shakafleet:latest`

On each push to `main`, GitHub Actions builds and publishes multi-arch images (amd64 + arm64).
