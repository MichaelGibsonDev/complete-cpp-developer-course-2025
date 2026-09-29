# C++ Course Runner

## Overview
This repository is a collection of C++ course exercises organized into sections (section_1 through section_12). A web-based runner (Express backend + vanilla JS frontend) lets you browse, compile, and run every program from the browser.

## Architecture
- `server/index.js` — Express server that scans for C++ programs, serves source code, and compiles/runs programs via g++
- `public/index.html` — Single-page frontend (dark theme, vanilla JS, highlight.js from CDN)
- `Dockerfile.base44` — `node:22-slim` + `build-essential` (provides g++)
- `docker-compose.base44.yml` — dev setup with bind mount and `node --watch` live reload

## Running
```bash
docker compose -f docker-compose.base44.yml up -d --build
```
App is served on port 3000. Health check at `/api/health`.

## How it works
- Server scans `section_*` directories for folders containing `main.cpp`
- Each program is compiled with `g++ -std=c++17` (all .cpp files in the folder compiled together; .h files are included via `#include`)
- Programs run with user-provided stdin, 10s execution timeout, 30s compile timeout
- Multi-file projects (e.g. section_10/RPGProject with Player/Warrior/Priest/Mage) are supported automatically
- Programs that read from files (section_9) run with `cwd` set to their source directory

## No external secrets required
This is a self-contained local tool — no API keys or external credentials needed.
