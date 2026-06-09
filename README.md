# 🎭 Mafia: The Automated Assembly

Live phone-powered social deduction game for large groups (6–100 players). No app download needed — just a browser.

**Host opens the page on a projector → players scan QR with their phones → game plays itself.**

## How It Works

| Component | Stack |
|-----------|-------|
| Frontend | GitHub Pages (static HTML/JS/CSS) |
| Backend | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Auth | Anonymous tokens (server-generated) |
| Real-time | 2-second polling via API |

No VPS, no Docker, no monthly costs.

## Quick Start

### 1. Deploy the Worker

```bash
cd worker
npm install
npx wrangler d1 create mafia-game-db
npx wrangler d1 execute mafia-game-db --file=schema.sql
npx wrangler deploy
```

Copy the deployed URL (e.g. `https://mafia-game.xxx.workers.dev`).

### 2. Update Frontend Config

Edit `js/config.js`:

```js
window.API_URL = "https://mafia-game.xxx.workers.dev";
```

### 3. Deploy Frontend to GitHub Pages

```bash
git add .
git commit -m "deploy"
git push
```

Enable GitHub Pages in repo settings (Source: main branch, root folder).

### 4. Play!

Open `https://your-username.github.io/mafia-automated-assembly/` on a projector.

## Development

```bash
# Run Worker locally
cd worker
npm run dev

# Open locally
open http://localhost:8787
```

## Game Phases

1. **Lobby** — Players scan QR, enter name, join room
2. **Night** — Werewolves pick victim, Seer investigates, Doctor protects
3. **Day Discussion** — Everyone talks IRL
4. **Vote** — Players vote on phones to eliminate a suspect
5. **Resolution** — Role revealed, check win condition
6. **Repeat** until werewolves outnumber villagers or all werewolves are dead

## Architecture

```
GitHub Pages                  Cloudflare Workers
┌─────────────────┐           ┌─────────────────────┐
│ index.html       │──fetch──→│ /api/rooms           │
│ player.html      │          │ /api/players         │
│ js/config.js     │          │ /api/player-roles    │
│ js/game-state.js │          │ /api/night-actions   │
│ css/style.css    │          │ /api/day-votes       │
└─────────────────┘          │ /api/assign-roles    │
                             │ /api/process-night   │
                             │ /api/process-day     │
                             └──────────┬────────────┘
                                        │
                             ┌──────────▼────────────┐
                             │  Cloudflare D1 (SQLite)│
                             └───────────────────────┘
```

## Cost Estimate

| Service | Cost |
|---------|------|
| GitHub Pages | Free |
| Cloudflare Workers (free tier) | Free — 100k req/day |
| Cloudflare D1 (free tier) | Free — 5GB storage, 5M read rows/day |
| **Total** | **$0/month** |

## Security

- Secret roles stored server-side, never leaked to client
- Anonymous tokens verify player identity
- APIs validate player owns their actions (can't vote for someone else)
- No Supabase, no third-party backend dependencies
