# Project rules

## Git commits
- Commits must be authored under the user's own git identity (the configured `user.name` / `user.email`).
- Do NOT add Claude as author or co-author: no `Co-Authored-By: Claude ...` trailer, and no "Generated with Claude Code" lines in commit messages or PR descriptions.

## Secrets
- Never commit secrets. Only `.env.example` files are tracked.

## Frontend: MapLibre
- maplibre-gl v6 ships its worker as a separate file and has no default export.
- Always import from `src/utils/maplibre.ts` (never directly from `maplibre-gl`); it registers the worker URL via `setWorkerUrl`.
