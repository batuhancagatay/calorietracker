const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');
const db = require('../db');

const router = express.Router();

const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer';
const KJ_PER_KCAL = 4.184;

function randomState() {
  // Whoop requires an 8-character state string if you generate it yourself
  return crypto.randomBytes(4).toString('hex');
}

// ---- Step 1: send the user to Whoop to authorize ----
router.get('/auth/whoop', (req, res) => {
  const state = randomState();
  req.session.whoop_oauth_state = state;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.WHOOP_CLIENT_ID,
    redirect_uri: process.env.WHOOP_REDIRECT_URI,
    // offline -> refresh token; read:cycles -> energy burn data
    scope: 'offline read:cycles read:profile',
    state
  });

  res.redirect(`${WHOOP_AUTH_URL}?${params.toString()}`);
});

// ---- Step 2: Whoop redirects back here with a code ----
router.get('/auth/whoop/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`/?whoop_error=${encodeURIComponent(error)}`);
  }
  if (!state || state !== req.session.whoop_oauth_state) {
    return res.status(400).send('Invalid OAuth state. Please try connecting again.');
  }
  delete req.session.whoop_oauth_state;

  try {
    const tokenRes = await fetch(WHOOP_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: process.env.WHOOP_CLIENT_ID,
        client_secret: process.env.WHOOP_CLIENT_SECRET,
        redirect_uri: process.env.WHOOP_REDIRECT_URI
      })
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      console.error('Whoop token exchange failed:', tokenRes.status, text);
      return res.status(502).send('Could not connect to Whoop. Check server logs.');
    }

    const tokens = await tokenRes.json();
    saveTokens(tokens);
    res.redirect('/?whoop_connected=1');
  } catch (err) {
    console.error(err);
    res.status(500).send('Unexpected error connecting to Whoop.');
  }
});

function saveTokens(tokens) {
  const expiresAt = Date.now() + (tokens.expires_in - 60) * 1000; // refresh 1 min early
  db.prepare(
    `INSERT INTO whoop_tokens (id, access_token, refresh_token, expires_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = COALESCE(excluded.refresh_token, whoop_tokens.refresh_token),
       expires_at = excluded.expires_at`
  ).run(tokens.access_token, tokens.refresh_token || null, expiresAt);
}

async function refreshTokens(refreshToken) {
  const res = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.WHOOP_CLIENT_ID,
      client_secret: process.env.WHOOP_CLIENT_SECRET,
      scope: 'offline'
    })
  });
  if (!res.ok) throw new Error(`Whoop refresh failed: ${res.status} ${await res.text()}`);
  const tokens = await res.json();
  saveTokens(tokens);
  return tokens.access_token;
}

async function getValidAccessToken() {
  const row = db.prepare('SELECT * FROM whoop_tokens WHERE id = 1').get();
  if (!row) return null;
  if (Date.now() < row.expires_at) return row.access_token;
  if (!row.refresh_token) return null; // expired, no way to refresh
  return refreshTokens(row.refresh_token);
}

// ---- status: is Whoop connected? ----
router.get('/api/whoop/status', (req, res) => {
  const row = db.prepare('SELECT id FROM whoop_tokens WHERE id = 1').get();
  res.json({ connected: !!row });
});

router.post('/api/whoop/disconnect', (req, res) => {
  db.prepare('DELETE FROM whoop_tokens WHERE id = 1').run();
  res.json({ ok: true });
});

// ---- today's energy burn, from the most recent physiological cycle ----
router.get('/api/whoop/today', async (req, res) => {
  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return res.status(401).json({ error: 'not_connected' });
    }

    const cycleRes = await fetch(`${WHOOP_API_BASE}/v2/cycle?limit=1`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (cycleRes.status === 401) {
      return res.status(401).json({ error: 'not_connected' });
    }
    if (!cycleRes.ok) {
      const text = await cycleRes.text();
      console.error('Whoop cycle fetch failed:', cycleRes.status, text);
      return res.status(502).json({ error: 'whoop_api_error' });
    }

    const body = await cycleRes.json();
    const cycle = (body.records || [])[0];

    if (!cycle || cycle.score_state !== 'SCORED' || !cycle.score) {
      return res.json({
        calories_burned: null,
        score_state: cycle ? cycle.score_state : 'NONE',
        cycle_start: cycle ? cycle.start : null,
        note: 'Whoop has not finished scoring today\u2019s cycle yet.'
      });
    }

    const calories = Math.round(cycle.score.kilojoule / KJ_PER_KCAL);
    res.json({
      calories_burned: calories,
      score_state: cycle.score_state,
      cycle_start: cycle.start,
      strain: cycle.score.strain
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
