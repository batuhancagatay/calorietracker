# Ledger — photo calorie tracker + Whoop energy balance

Take a photo of a meal, get a calorie estimate from Claude, log it, and see
your running total against today's Whoop calorie burn (calories out − calories in).

## What's inside

- **`server/`** — Node/Express backend
  - Calls the Anthropic API to analyze food photos (vision)
  - Handles the Whoop OAuth2 flow and refreshes tokens automatically
  - Stores your daily food log in a local SQLite file (`server/data.sqlite`)
- **`public/`** — the frontend (plain HTML/CSS/JS, camera capture via `getUserMedia`)

The Whoop OAuth exchange has to happen on a server (it needs your Client Secret),
which is why this is a standalone app with a backend rather than a pure
in-browser tool.

## 1. Get your API keys

**Anthropic API key**
Create one at [console.anthropic.com](https://console.anthropic.com/settings/keys).

**Whoop developer app**
1. Go to the [Whoop Developer Dashboard](https://developer-dashboard.whoop.com) and create an app.
2. Set its **Redirect URL** to `http://localhost:3000/auth/whoop/callback` (must match exactly).
3. Copy the Client ID and Client Secret it gives you.
4. Note: Whoop requires you to own a Whoop device/membership to use the Developer Platform.

## 2. Configure

```bash
cd server
cp .env.example .env
```

Edit `server/.env` and fill in:
- `ANTHROPIC_API_KEY`
- `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `WHOOP_REDIRECT_URI`
- `SESSION_SECRET` — any long random string

## 3. Run it

```bash
cd server
npm install
npm start
```

Open **http://localhost:3000**. On first load, click **Connect Whoop** to
authorize; after that the app will read today's calorie burn automatically
from your most recent physiological cycle.

## How it works

1. **Capture** — take a photo (camera or upload).
2. **Analyze** — the photo is sent to Claude, which returns identified food
   items, portions, and an estimated calorie total. You can edit the total
   before saving — treat it as an estimate, not a lab measurement.
3. **Log** — confirmed entries are saved to today's log (SQLite, local only).
4. **Balance** — the gauge at the top shows calories in (amber), today's
   Whoop burn (blue marker), and the net remaining or over.

## Notes & limits

- Whoop's current physiological cycle only gets a final energy-burn score
  once WHOOP finishes scoring it — if you connect early in the day, "out"
  may show as unavailable until there's enough data.
- This app is single-user by design (one local SQLite file, one Whoop
  token). For multi-user use you'd need per-user accounts and a shared
  database instead of a single `whoop_tokens` row.
- Calorie estimates from a photo are inherently approximate — lighting,
  portion size, and hidden ingredients (oil, sauces) all affect accuracy.
- To deploy beyond localhost, update `WHOOP_REDIRECT_URI` (and the
  registered Redirect URL in the Whoop dashboard) to your real domain, and
  keep `.env` out of version control.
