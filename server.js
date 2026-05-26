const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8306;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(cors());
app.use(express.json({ limit: '10mb' }));

function readData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {}
  return {};
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data), 'utf8');
}

// API routes
app.get('/api', (req, res) => {
  const data = readData();
  if (req.query.action === 'getAll') return res.json({ ok: true, data });
  const key = req.query.key;
  res.json({ ok: true, value: key ? (data[key] || null) : null });
});

app.post('/api', (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ ok: false });
  const data = readData();
  data[key] = value;
  writeData(data);
  res.json({ ok: true });
});

// Serve portal
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Wiom DigiDesk running on port ${PORT}`));
