# AGENTS.md

Instructions for agents (and me) working in this repo. `CLAUDE.md` just imports this file.

## What this is

A personal, modified fork of [AienTech/dossier](https://github.com/AienTech/dossier) (AGPL-3.0, like the original). Dossier is a self-hosted job-search app: one profile, a tailored resume and cover letter for each job, and applications tracked from draft to offer. The stack is Next.js 16 (App Router), Prisma 7 and PostgreSQL 18 (SQLite also works), with Yarn 4 and Docker Compose.

- `origin` is `krishnavalliappan/dossier` (this fork). `upstream` is `AienTech/dossier`.
- Live at https://agents.tail1e8966.ts.net:8444. It's private and only reachable over Tailscale.
- The architecture and conventions are in [DEVELOPMENT.md](DEVELOPMENT.md). Read the relevant section before you change an area.

## Run and test locally

Per [DEVELOPMENT.md](DEVELOPMENT.md), everything runs in the containers, not on the host:

```bash
cp .env.example .env
docker compose build
docker/bin/yarn hash-password   # put the output in DOSSIER_PASSWORD in .env
# set DOSSIER_SECRET in .env (openssl rand -base64 32)
docker compose up               # http://localhost:3000, hot reload
```

Run Yarn through `docker/bin/yarn`. It uses the running `app` container, or a one-off one if it's stopped.

```bash
docker/bin/yarn lint
docker/bin/yarn typecheck       # next typegen && tsc --noEmit
docker/bin/yarn test            # Vitest; *.db.test.ts use a dossier_test database
docker/bin/yarn build && docker/bin/yarn test:e2e   # Playwright against a production build
```

- Tests go next to the code they cover.
- Pull requests aren't checked by CI, so run lint, typecheck and tests yourself before opening one.
- This VPS sandbox has limited memory. Run one heavy job at a time, and only one dev server.

## Database changes

- Use Prisma migrations only.
  - Edit `prisma/schema.prisma`, the only schema you edit by hand.
  - Run `docker/bin/yarn prisma migrate dev --name <name>`.
  - Update the SQLite schema and its migration too: `docker/bin/yarn sqlite-schema`. DEVELOPMENT.md → SQLite has the details.
- The production image runs `prisma migrate deploy` every time it starts (`docker/start.sh`). A migration merged to `main` therefore runs against production data on the next deploy. Make sure it's safe for existing rows.

## Deploy

Merging a PR into `main` is the deploy. There is no manual deploy step.

1. A push to `main` runs the GitHub Actions **Image** workflow (`.github/workflows/image.yml`). It runs CI, then builds `ghcr.io/krishnavalliappan/dossier:main` for amd64 and arm64. This takes about 15 min.
2. On the VPS, the systemd timer `dossier-deploy.timer` runs `/home/ubuntu/dossier/deploy.sh` every 5 min. The script:
   - pulls the new image;
   - runs `pg_dump` into `/home/ubuntu/dossier/predeploy/`, keeping the last 5 dumps;
   - runs `docker compose up -d app`;
   - waits for the Docker health check (`/api/health`).

   If the app is still unhealthy after 3 min, it rolls back to the previous image and marks the bad build so later runs skip it.
3. Production runs from `/home/ubuntu/dossier` (`compose.yml` and `.env`), owned by the `ubuntu` user. It does not run from this repo folder. Postgres data is in Docker volumes and survives deploys.

- Force a deploy now: `sudo systemctl start dossier-deploy.service`
- Logs:
  - `sudo journalctl -u dossier-deploy -n 20`
  - `cd /home/ubuntu/dossier && sudo docker compose logs --tail 50 app`
- Only the **CI** and **Image** workflows are enabled on the fork. Pages, Desktop and Release are turned off.

## Git rules

- Never push to `main`. A pre-push hook blocks it. Work on a branch, then open a PR:
  `gh pr create -R krishnavalliappan/dossier --base main`
- Always pass `-R krishnavalliappan/dossier` to `gh`. Never open PRs or issues on AienTech/dossier.
- Upstream sync: on a branch, run `git fetch upstream && git merge upstream/main`, then open a PR on the fork.
- When you add a fork change, add a row to the "Fork changes vs upstream" table at the top of README.md.

## Don't

- Don't edit `compose.production.yml`, `Dockerfile` or `.github/workflows/` unless asked. Production depends on them.
- Don't commit secrets, or anything from `/home/ubuntu/dossier/.env`.
- Don't edit the upstream part of README.md, below the fork section. Keep fork changes small and isolated so upstream merges stay easy.
