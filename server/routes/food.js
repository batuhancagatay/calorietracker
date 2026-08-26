const express = require('express');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function todayStr() {
  // Server-local calendar day, e.g. "2026-08-26"
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

const ANALYSIS_PROMPT = `You are a nutrition estimation assistant embedded in a calorie tracking app.
Look at the photo of food and identify what's in it, then estimate calories.

Respond with ONLY a JSON object, no other text, no markdown fences, in this exact shape:
{
  "items": [{"name": "string", "portion": "string, e.g. '1 cup' or '150g'", "calories": integer}],
  "total_calories": integer,
  "confidence": "low" | "medium" | "high",
  "note": "one short sentence about assumptions made (portion size, cooking method, etc.)"
}

If the image does not clearly show food, set "items" to an empty array, "total_calories" to 0,
"confidence" to "low", and explain why in "note".`;

router.post('/api/analyze-food', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no_photo' });

    const base64 = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype && req.file.mimetype.startsWith('image/')
      ? req.file.mimetype
      : 'image/jpeg';

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: ANALYSIS_PROMPT }
        ]
      }]
    });

    const raw = message.content.find(b => b.type === 'text')?.text || '{}';
    const cleaned = raw.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('Could not parse model output:', raw);
      return res.status(502).json({ error: 'parse_failed', raw });
    }

    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

// ---- add a confirmed entry to today's log ----
router.post('/api/food-log', (req, res) => {
  const { name, calories, confidence, note, day } = req.body;
  if (!name || typeof calories !== 'number') {
    return res.status(400).json({ error: 'invalid_body' });
  }
  const targetDay = day || todayStr();
  const stmt = db.prepare(
    `INSERT INTO food_log (day, name, calories, confidence, note) VALUES (?, ?, ?, ?, ?)`
  );
  const info = stmt.run(targetDay, name, Math.round(calories), confidence || null, note || null);
  res.json({ id: info.lastInsertRowid });
});

// ---- today's log + running total ----
router.get('/api/food-log/today', (req, res) => {
  const day = todayStr();
  const rows = db.prepare(
    `SELECT id, name, calories, confidence, note, created_at
     FROM food_log WHERE day = ? ORDER BY created_at ASC`
  ).all(day);
  const total = rows.reduce((sum, r) => sum + r.calories, 0);
  res.json({ day, entries: rows, total_calories: total });
});

router.delete('/api/food-log/:id', (req, res) => {
  db.prepare('DELETE FROM food_log WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
