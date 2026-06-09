# 🎭 Mafia: The Automated Assembly

A live, phone-powered social deduction game for **100+ players** in a classroom. Everyone gets a secret role on their phone; the projector becomes the public "town square". No manual narrator needed.

## How It Works

1. **Host** opens `index.html` on the classroom projector → a room code & QR appear
2. **100 players** scan the QR, enter their name, receive a secret role
3. **Night phase**: Werewolves silently pick a victim on their phones; the Seer investigates; the Doctor protects
4. **Day phase**: The projector announces who was attacked. Everyone discusses IRL. Then all vote on their phones to eliminate a suspect
5. The app reveals their role on the big screen and checks win conditions
6. Repeat until Werewolves outnumber Villagers or all Werewolves are dead

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Vanilla HTML/CSS/JS (2 pages: host + player) |
| Hosting | GitHub Pages (static) |
| Backend | Supabase (Postgres, Realtime, Edge Functions) |
| Auth | Supabase Anonymous Auth |
| Real-time | Supabase Broadcast + Postgres Realtime |
| QR | qrcodejs library |

## Setup

### 1. Supabase Project

1. Create a free Supabase project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** → run `supabase/migrations/001_schema.sql`
3. Go to **Project Settings → API** → copy the **Project URL** and **anon key**
4. Go to **Authentication → Settings** → enable **Anonymous sign-ins**
5. Go to **Edge Functions** → deploy the 3 functions:
   - `assign-roles`
   - `process-night`
   - `process-day`

### 2. Configuration

Copy `js/config.template.js` to `js/config.js` and fill in your Supabase credentials:

```js
window.SUPABASE_URL = 'https://your-project.supabase.co';
window.SUPABASE_ANON_KEY = 'your-anon-key';
```

### 3. Deploy to GitHub Pages

```bash
# Push to GitHub
git push origin main

# Enable GitHub Pages:
# Settings → Pages → Source: GitHub Actions (or deploy from root)
```

### 4. Game Flow

| Phase | Duration (configurable) | What happens |
|-------|------------------------|--------------|
| Night | 60s | Werewolves vote victim, Seer investigates, Doctor protects |
| Day Discussion | 180s | Everyone discusses in-person |
| Day Vote | 60s | Everyone votes on their phone |
| Results | 15s | Role revealed on projector |

## Roles

| Role | Team | Ability |
|------|------|---------|
| 🏘️ **Villager** | Village | Find and vote out werewolves |
| 🐺 **Werewolf** | Werewolves | Eliminate one player each night |
| 🔮 **Seer** | Village | Investigate one player each night |
| 💉 **Doctor** | Village | Protect one player each night |

## Win Conditions

- **Village wins**: All werewolves eliminated
- **Werewolves win**: Werewolves outnumber or equal villagers

## Privacy & Trust

- Players sign in anonymously — no accounts needed
- Roles are assigned server-side via Edge Functions
- RLS policies ensure only you can see your own role (until death)
- The host never sees who has which role
