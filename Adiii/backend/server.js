/**
 * Campus Board — Production Backend Server
 * Built for Campus Pulse Hackathon (Google for Developers x CSSS)
 * 
 * Provides:
 * - RESTful Notice Management (CRUD)
 * - Server-side Gemini 2.0 Flash integration (keeps API keys secure)
 * - Intelligent regex fallback if API key is not provided
 * - JSON File Database persistence with automatic fallback
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static frontend files if hosted together
app.use(express.static(path.join(__dirname, '..')));

// Persistence Database File
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'notices.json');

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-Memory Cache synced with disk
let notices = [];

function loadData() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      notices = JSON.parse(raw);
    } else {
      // Seed initial demo data
      notices = [
        {
          id: 'demo-1',
          title: 'Computer Networks Lab Record Submission',
          category: 'deadline',
          date: getRelativeDate(1),
          time: '17:00',
          venue: 'Room 204',
          group: 'CSE 3rd Year',
          originalMessage: 'Urgent: Kal 5 baje Computer Networks ka lab record submit krna hai Room 204 me.',
          starred: true,
          done: false,
          createdAt: Date.now() - 3600000
        },
        {
          id: 'demo-2',
          title: 'End Sem Practical Exam',
          category: 'exam',
          date: getRelativeDate(3),
          time: '10:00',
          venue: 'Lab 3',
          group: 'CSE Dept',
          originalMessage: 'End Sem Practical Exam scheduled on 3 Nov at 10:00 am in Lab 3.',
          starred: false,
          done: false,
          createdAt: Date.now() - 7200000
        },
        {
          id: 'demo-3',
          title: 'Capgemini Campus Placement Drive',
          category: 'placement',
          date: getRelativeDate(4),
          time: '09:00',
          venue: 'Auditorium',
          group: 'T&P Cell',
          originalMessage: 'Capgemini Campus Placement Drive on Friday 9:00 am in Auditorium. Dress code formal.',
          starred: true,
          done: false,
          createdAt: Date.now() - 10800000
        }
      ];
      saveData();
    }
  } catch (err) {
    console.error('Error loading database:', err);
    notices = [];
  }
}

function saveData() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(notices, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving database:', err);
  }
}

function getRelativeDate(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

// Initialize data
loadData();

// ─────────────────────────────────────────────────────────────
// 1. HEALTH & STATUS ENDPOINT
// ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    app: 'Campus Board API',
    uptime: process.uptime(),
    geminiActive: !!GEMINI_API_KEY,
    totalNotices: notices.length,
    timestamp: new Date().toISOString()
  });
});

// ─────────────────────────────────────────────────────────────
// 2. NOTICE CRUD ENDPOINTS
// ─────────────────────────────────────────────────────────────

// GET all notices
app.get('/api/notices', (req, res) => {
  res.json({ success: true, count: notices.length, data: notices });
});

// POST add notice (single or bulk)
app.post('/api/notices', (req, res) => {
  const payload = req.body;
  if (Array.isArray(payload)) {
    const newItems = payload.map(item => ({
      id: item.id || Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
      title: item.title || 'Untitled notice',
      category: item.category || 'general',
      date: item.date || null,
      time: item.time || null,
      venue: item.venue || null,
      group: item.group || null,
      originalMessage: item.originalMessage || '',
      starred: !!item.starred,
      done: !!item.done,
      createdAt: item.createdAt || Date.now()
    }));
    notices.unshift(...newItems);
    saveData();
    return res.status(201).json({ success: true, added: newItems.length, data: newItems });
  }

  if (!payload.title) {
    return res.status(400).json({ success: false, error: 'Notice title is required' });
  }

  const notice = {
    id: payload.id || Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
    title: payload.title,
    category: payload.category || 'general',
    date: payload.date || null,
    time: payload.time || null,
    venue: payload.venue || null,
    group: payload.group || null,
    originalMessage: payload.originalMessage || '',
    starred: !!payload.starred,
    done: !!payload.done,
    createdAt: Date.now()
  };

  notices.unshift(notice);
  saveData();
  res.status(201).json({ success: true, data: notice });
});

// PUT update notice
app.put('/api/notices/:id', (req, res) => {
  const { id } = req.params;
  const index = notices.findIndex(n => n.id === id);
  if (index === -1) {
    return res.status(404).json({ success: false, error: 'Notice not found' });
  }

  notices[index] = {
    ...notices[index],
    ...req.body,
    id // keep original id
  };

  saveData();
  res.json({ success: true, data: notices[index] });
});

// DELETE notice
app.delete('/api/notices/:id', (req, res) => {
  const { id } = req.params;
  const initialLen = notices.length;
  notices = notices.filter(n => n.id !== id);

  if (notices.length === initialLen) {
    return res.status(404).json({ success: false, error: 'Notice not found' });
  }

  saveData();
  res.json({ success: true, message: 'Notice deleted successfully' });
});

// ─────────────────────────────────────────────────────────────
// 3. AI ENDPOINTS: PARSE, DIGEST & NATURAL LANGUAGE Q&A
// ─────────────────────────────────────────────────────────────

// POST /api/ai/parse — Extract notice using Gemini or Regex fallback
app.post('/api/ai/parse', async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ success: false, error: 'Text content is required' });
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const dayName = days[new Date().getDay()];

  if (GEMINI_API_KEY) {
    try {
      const prompt = `You are an AI assistant that extracts structured notice items from messy student messages (WhatsApp forwards, emails, poster captions, Hinglish).
Today is ${dayName}, ${todayStr}.

Extract each notice into:
- title: concise title (max 12 words)
- category: one of "deadline", "exam", "event", "placement", "general"
- date: YYYY-MM-DD. Resolve "tomorrow", "kal", "aaj", "parso", and weekday names relative to ${todayStr}.
- time: HH:MM 24h format (convert "5 pm" to "17:00", "5 baje" to "17:00", "morning" to "09:00").
- venue: location if mentioned, else null.

Reply with ONLY valid JSON (no markdown). Single notice: object. Multiple: array.

Text:
"""
${text}
"""`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
          })
        }
      );

      if (response.ok) {
        const data = await response.json();
        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
        const parsed = JSON.parse(cleaned);
        return res.json({ success: true, engine: 'gemini-2.0-flash', data: parsed });
      }
    } catch (err) {
      console.warn('Server Gemini call failed, using server regex fallback:', err.message);
    }
  }

  // Fallback regex parsing
  const fallbackResult = serverRegexParse(text, todayStr);
  res.json({ success: true, engine: 'local-regex-fallback', data: fallbackResult });
});

// POST /api/ai/digest — Generate weekly digest
app.post('/api/ai/digest', async (req, res) => {
  const { currentNotices } = req.body;
  const list = currentNotices || notices;
  const todayStr = new Date().toISOString().split('T')[0];

  if (GEMINI_API_KEY && list.length > 0) {
    try {
      const summary = list.map(n =>
        `- [${n.category}] ${n.title} on ${n.date || 'no date'}${n.time ? ' at ' + n.time : ''}${n.venue ? ' at ' + n.venue : ''}${n.done ? ' (COMPLETED)' : ''}`
      ).join('\n');

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `You are Campus Board AI. Create a short, friendly, readable digest (3-5 bullet points) summarizing upcoming notices for a student. Highlight urgent deadlines. Today is ${todayStr}.\n\nNotices:\n${summary}` }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 512 }
          })
        }
      );

      if (response.ok) {
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return res.json({ success: true, engine: 'gemini', digest: text });
      }
    } catch (e) {
      console.warn('Gemini digest error:', e.message);
    }
  }

  // Local digest generator
  const localText = generateServerDigest(list);
  res.json({ success: true, engine: 'local', digest: localText });
});

// POST /api/ai/ask — Natural language assistant
app.post('/api/ai/ask', async (req, res) => {
  const { question, currentNotices } = req.body;
  const list = currentNotices || notices;
  const todayStr = new Date().toISOString().split('T')[0];

  if (GEMINI_API_KEY) {
    try {
      const summary = list.map(n =>
        `• ${n.title} | Category: ${n.category} | Date: ${n.date} | Time: ${n.time} | Venue: ${n.venue} | Done: ${n.done}`
      ).join('\n');

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `You are Campus Board AI. Answer the student's question based strictly on their schedule. Today is ${todayStr}.\n\nNotices:\n${summary}\n\nQuestion: "${question}"\n\nBe concise and friendly (1-3 sentences).` }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 256 }
          })
        }
      );

      if (response.ok) {
        const data = await response.json();
        return res.json({ success: true, answer: data.candidates?.[0]?.content?.parts?.[0]?.text || '' });
      }
    } catch (e) {}
  }

  res.json({ success: true, answer: `You currently have ${list.filter(n => !n.done).length} active items on your schedule.` });
});

// Helper: Server Regex Parser
function serverRegexParse(text, todayStr) {
  const t = text.toLowerCase();
  let category = 'general';
  if (/\b(deadline|submit|submission|last date|due date|assignment|project submit)\b/.test(t)) category = 'deadline';
  else if (/\b(exam|test|quiz|viva|mid[\s-]?sem|end[\s-]?sem|mst)\b/.test(t)) category = 'exam';
  else if (/\b(placement|drive|company|interview|aptitude|recruit|package|ctc|lpa)\b/.test(t)) category = 'placement';
  else if (/\b(event|fest|seminar|workshop|hackathon|cultural|sports)\b/.test(t)) category = 'event';

  let lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 3);
  let title = (lines[0] || text.trim()).replace(/^(urgent|important|reminder|notice)[:\s!*-]*/i, '').replace(/[_*~`]/g, '');
  if (title.length > 80) title = title.substring(0, 77) + '…';

  return {
    title: title || 'Untitled notice',
    category,
    date: todayStr,
    time: null,
    venue: null
  };
}

function generateServerDigest(list) {
  const undone = list.filter(n => !n.done);
  const dl = undone.filter(n => n.category === 'deadline' || n.category === 'exam');
  return `You have ${undone.length} pending items, including ${dl.length} urgent deadlines/exams. Stay focused!`;
}

// Start Server
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Campus Board Server running at http://localhost:${PORT}`);
  console.log(`📊 Mode: ${GEMINI_API_KEY ? '⚡ Gemini 2.0 Flash Active' : '⚙️ Smart Regex Fallback'}`);
  console.log(`📁 Persistence: ${DB_FILE}`);
  console.log(`======================================================\n`);
});

