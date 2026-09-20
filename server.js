'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3737;

// ─── Paths ───────────────────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'db', 'library.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure dirs exist
[path.join(__dirname, 'db'), UPLOADS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ─── JSON "Database" ─────────────────────────────────────────────────────────
const DEFAULT_DB = {
  entries: [],
  boards: [],
  tags: [
    'Minimal', 'Brutalist', 'Dark Mode', 'Light Mode', 'Glassmorphism',
    'Neumorphism', 'Flat', 'Material', 'Gradient', 'Monochrome',
    'Typographic', 'Editorial', 'Playful', 'Corporate', 'Retro',
    'Futuristic', 'Hand-drawn', 'Geometric', 'Organic', 'Bold',
    'Clean', 'Dense', 'Spacious', 'Colorful', 'Muted', 'Illustrated'
  ],
  types: ['Website', 'Mobile App', 'Web App']
};

function readDB() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
  // Back-fill fields added after this file was first written
  if (!data.types) data.types = [...DEFAULT_DB.types];
  return data;
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ─── Multer (screenshot uploads) ─────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// ─── Entries ──────────────────────────────────────────────────────────────────

// List entries (with filter/search)
app.get('/api/entries', (req, res) => {
  const db = readDB();
  let entries = db.entries;
  const { q, type, tags, board, favorite, tagMode } = req.query;

  if (q) {
    const lower = q.toLowerCase();
    entries = entries.filter(e =>
      e.url.toLowerCase().includes(lower) ||
      (e.note || '').toLowerCase().includes(lower) ||
      (e.style_tags || []).some(t => t.toLowerCase().includes(lower))
    );
  }
  if (type) {
    entries = entries.filter(e => e.type === type);
  }
  if (tags) {
    const selected = Array.isArray(tags) ? tags : [tags];
    if (tagMode === 'all') {
      entries = entries.filter(e => selected.every(t => (e.style_tags || []).includes(t)));
    } else {
      entries = entries.filter(e => selected.some(t => (e.style_tags || []).includes(t)));
    }
  }
  if (board) {
    entries = entries.filter(e => (e.boards || []).includes(board));
  }
  if (favorite === 'true') {
    entries = entries.filter(e => e.favorite);
  }

  // Default sort: newest first
  entries = [...entries].sort((a, b) => new Date(b.date_added) - new Date(a.date_added));
  res.json(entries);
});

// Get single entry
app.get('/api/entries/:id', (req, res) => {
  const db = readDB();
  const entry = db.entries.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  res.json(entry);
});

// Create entry
app.post('/api/entries', (req, res) => {
  const db = readDB();
  const { url, type, color, style_tags, note, found_via, favorite, boards } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  const existing = db.entries.find(e => e.url === url);
  const isDuplicate = !!existing;

  const entry = {
    id: uuidv4(),
    url,
    screenshot: null,
    type: type || null,
    color: color || null,
    style_tags: style_tags || [],
    note: note || '',
    found_via: found_via || '',
    favorite: favorite || false,
    boards: boards || [],
    date_added: new Date().toISOString()
  };

  db.entries.push(entry);
  writeDB(db);
  res.status(201).json({ entry, isDuplicate });
});

// Update entry
app.put('/api/entries/:id', (req, res) => {
  const db = readDB();
  const idx = db.entries.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const allowed = ['url', 'type', 'color', 'style_tags', 'note', 'found_via', 'favorite', 'boards'];
  allowed.forEach(k => {
    if (req.body[k] !== undefined) db.entries[idx][k] = req.body[k];
  });
  writeDB(db);
  res.json(db.entries[idx]);
});

// Upload / replace screenshot
app.post('/api/entries/:id/screenshot', upload.single('screenshot'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const db = readDB();
  const idx = db.entries.findIndex(e => e.id === req.params.id);
  if (idx === -1) {
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'Entry not found' });
  }
  // Remove old screenshot if exists
  if (db.entries[idx].screenshot) {
    const old = path.join(UPLOADS_DIR, db.entries[idx].screenshot);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }
  db.entries[idx].screenshot = req.file.filename;
  writeDB(db);
  res.json({ screenshot: req.file.filename });
});

// Delete entry
app.delete('/api/entries/:id', (req, res) => {
  const db = readDB();
  const idx = db.entries.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [entry] = db.entries.splice(idx, 1);
  if (entry.screenshot) {
    const p = path.join(UPLOADS_DIR, entry.screenshot);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  writeDB(db);
  res.json({ ok: true });
});

// Bulk actions
app.post('/api/entries/bulk', (req, res) => {
  const { ids, action, tag, boards } = req.body;
  if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  const db = readDB();

  ids.forEach(id => {
    const idx = db.entries.findIndex(e => e.id === id);
    if (idx === -1) return;
    if (action === 'delete') {
      const [entry] = db.entries.splice(idx, 1);
      if (entry.screenshot) {
        const p = path.join(UPLOADS_DIR, entry.screenshot);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    } else if (action === 'tag' && tag) {
      if (!db.entries[idx].style_tags.includes(tag)) {
        db.entries[idx].style_tags.push(tag);
      }
    } else if (action === 'addToBoard' && boards) {
      const toAdd = Array.isArray(boards) ? boards : [boards];
      toAdd.forEach(b => {
        if (!db.entries[idx].boards.includes(b)) db.entries[idx].boards.push(b);
      });
    }
  });

  writeDB(db);
  res.json({ ok: true });
});

// ─── Boards ───────────────────────────────────────────────────────────────────
app.get('/api/boards', (req, res) => {
  const db = readDB();
  // Attach entry count
  const boards = db.boards.map(b => ({
    ...b,
    count: db.entries.filter(e => (e.boards || []).includes(b.id)).length
  }));
  res.json(boards);
});

app.post('/api/boards', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const db = readDB();
  const board = { id: uuidv4(), name, created: new Date().toISOString() };
  db.boards.push(board);
  writeDB(db);
  res.status(201).json(board);
});

app.put('/api/boards/:id', (req, res) => {
  const db = readDB();
  const idx = db.boards.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  if (req.body.name) db.boards[idx].name = req.body.name;
  writeDB(db);
  res.json(db.boards[idx]);
});

app.delete('/api/boards/:id', (req, res) => {
  const db = readDB();
  const idx = db.boards.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.boards.splice(idx, 1);
  // Remove board from all entries
  db.entries.forEach(e => {
    e.boards = (e.boards || []).filter(bid => bid !== req.params.id);
  });
  writeDB(db);
  res.json({ ok: true });
});

// ─── Tags ─────────────────────────────────────────────────────────────────────
app.get('/api/tags', (req, res) => {
  res.json(readDB().tags);
});

app.post('/api/tags', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const db = readDB();
  const normalized = name.trim();
  if (db.tags.map(t => t.toLowerCase()).includes(normalized.toLowerCase())) {
    return res.status(409).json({ error: 'Tag already exists' });
  }
  db.tags.push(normalized);
  writeDB(db);
  res.status(201).json({ tags: db.tags });
});

app.put('/api/tags/:name', (req, res) => {
  const { newName } = req.body;
  if (!newName) return res.status(400).json({ error: 'newName required' });
  const db = readDB();
  const oldName = decodeURIComponent(req.params.name);
  const idx = db.tags.findIndex(t => t === oldName);
  if (idx === -1) return res.status(404).json({ error: 'Tag not found' });
  db.tags[idx] = newName.trim();
  // Update in all entries
  db.entries.forEach(e => {
    e.style_tags = (e.style_tags || []).map(t => t === oldName ? newName.trim() : t);
  });
  writeDB(db);
  res.json({ tags: db.tags });
});

app.delete('/api/tags/:name', (req, res) => {
  const db = readDB();
  const name = decodeURIComponent(req.params.name);
  db.tags = db.tags.filter(t => t !== name);
  // Remove from all entries
  db.entries.forEach(e => {
    e.style_tags = (e.style_tags || []).filter(t => t !== name);
  });
  writeDB(db);
  res.json({ tags: db.tags });
});

// ─── Types ────────────────────────────────────────────────────────────────────
app.get('/api/types', (req, res) => {
  res.json(readDB().types);
});

app.post('/api/types', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const db = readDB();
  const normalized = name.trim();
  if (db.types.map(t => t.toLowerCase()).includes(normalized.toLowerCase())) {
    return res.status(409).json({ error: 'Type already exists' });
  }
  db.types.push(normalized);
  writeDB(db);
  res.status(201).json({ types: db.types });
});

// ─── Export ───────────────────────────────────────────────────────────────────
app.get('/api/export', (req, res) => {
  const db = readDB();
  const fmt = req.query.format || 'json';

  if (fmt === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename="taste-library-export.json"');
    res.json(db);
  } else {
    // ZIP with JSON + screenshots
    res.setHeader('Content-Disposition', 'attachment; filename="taste-library-export.zip"');
    res.setHeader('Content-Type', 'application/zip');
    const archive = archiver('zip');
    archive.pipe(res);
    archive.append(JSON.stringify(db, null, 2), { name: 'library.json' });
    // Add screenshot files
    db.entries.forEach(e => {
      if (e.screenshot) {
        const p = path.join(UPLOADS_DIR, e.screenshot);
        if (fs.existsSync(p)) archive.file(p, { name: `uploads/${e.screenshot}` });
      }
    });
    archive.finalize();
  }
});

// ─── Reset ────────────────────────────────────────────────────────────────────
app.post('/api/reset', (req, res) => {
  // Delete all screenshots
  const db = readDB();
  db.entries.forEach(e => {
    if (e.screenshot) {
      const p = path.join(UPLOADS_DIR, e.screenshot);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });
  writeDB(JSON.parse(JSON.stringify(DEFAULT_DB)));
  res.json({ ok: true });
});

// ─── Stats ────────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const db = readDB();
  res.json({
    entries: db.entries.length,
    boards: db.boards.length,
    tags: db.tags.length,
    favorites: db.entries.filter(e => e.favorite).length,
    withScreenshots: db.entries.filter(e => e.screenshot).length
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🎨 Taste Library running at http://localhost:${PORT}\n`);
});
