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

function validateDate(dateStr) {
  // Validate date format (YYYY-MM-DD) and ensure it's not in the future
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const date = new Date(dateStr + 'T00:00:00Z');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return !isNaN(date.getTime()) && date <= today;
}

function validateCalories(calories) {
  // Validate calories: must be number between 0 and 100,000
  return typeof calories === 'number' &&
         Number.isInteger(calories) &&
         calories >= 0 &&
         calories <= 100000;
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
    if (!req.file) {
      return res.status(400).json({ error: 'no_photo', message: 'Photo file is required' });
    }

    // Validate file size (already checked by multer, but double-check)
    if (req.file.size > 8 * 1024 * 1024) {
      return res.status(400).json({ error: 'file_too_large' });
    }

    // Validate MIME type
    if (!req.file.mimetype || !req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: 'invalid_file_type', message: 'File must be an image' });
    }

    const base64 = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype;

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
      console.error('Could not parse model output - JSON parse failed');
      // Don't expose raw LLM output to client
      return res.status(502).json({ error: 'analysis_failed', message: 'Could not analyze image' });
    }

    res.json(parsed);
  } catch (err) {
    console.error('Analysis error:', err.message);
    res.status(500).json({ error: 'server_error', message: 'Could not process image' });
  }
});

// ---- add a confirmed entry to today's log ----
router.post('/api/food-log', (req, res) => {
  const { name, calories, confidence, note, day } = req.body;

  // Validate input
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'invalid_body', message: 'name is required and must be a string' });
  }

  if (!validateCalories(calories)) {
    return res.status(400).json({ error: 'invalid_body', message: 'calories must be an integer between 0 and 100000' });
  }

  const targetDay = day || todayStr();
  if (!validateDate(targetDay)) {
    return res.status(400).json({ error: 'invalid_body', message: 'invalid date or date in future' });
  }

  // Sanitize name
  const sanitizedName = name.trim().substring(0, 500);

  try {
    const stmt = db.prepare(
      `INSERT INTO food_log (day, name, calories, confidence, note) VALUES (?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
      targetDay,
      sanitizedName,
      Math.round(calories),
      (confidence && typeof confidence === 'string') ? confidence.substring(0, 50) : null,
      (note && typeof note === 'string') ? note.substring(0, 500) : null
    );
    res.json({ id: info.lastInsertRowid });
  } catch (err) {
    console.error('Database error:', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

// ---- today's log + running total ----
router.get('/api/food-log/today', (req, res) => {
  const day = todayStr();
  try {
    const rows = db.prepare(
      `SELECT id, name, calories, confidence, note, created_at
       FROM food_log WHERE day = ? ORDER BY created_at ASC`
    ).all(day);
    const total = rows.reduce((sum, r) => sum + r.calories, 0);
    res.json({ day, entries: rows, total_calories: total });
  } catch (err) {
    console.error('Database error:', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

// ---- update entry ----
router.put('/api/food-log/:id', (req, res) => {
  const { name, calories } = req.body;
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({ error: 'invalid_id' });
  }

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'invalid_body', message: 'name is required' });
  }

  if (!validateCalories(calories)) {
    return res.status(400).json({ error: 'invalid_body', message: 'calories must be an integer between 0 and 100000' });
  }

  try {
    const sanitizedName = name.trim().substring(0, 500);
    const result = db.prepare(
      `UPDATE food_log SET name = ?, calories = ? WHERE id = ?`
    ).run(sanitizedName, Math.round(calories), id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'not_found' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Database error:', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

// ---- delete entry ----
router.delete('/api/food-log/:id', (req, res) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({ error: 'invalid_id' });
  }

  try {
    const result = db.prepare('DELETE FROM food_log WHERE id = ?').run(id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'not_found' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Database error:', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
