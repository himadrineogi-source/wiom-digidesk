const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 8306;

const GH_TOKEN = process.env.GH_TOKEN;
const GH_REPO = 'Wiom-using-AI/wiom-digidesk';
const GH_FILE = 'data.json';

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// In-memory cache to avoid hammering GitHub API
let _memCache = null;
let _memSha = null;

function ghRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `token ${GH_TOKEN}`,
        'User-Agent': 'wiom-digidesk',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      }
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function readData() {
  if (_memCache !== null) return _memCache;
  try {
    const r = await ghRequest('GET', `/repos/${GH_REPO}/contents/${GH_FILE}`);
    if (r.content) {
      _memSha = r.sha;
      _memCache = JSON.parse(Buffer.from(r.content, 'base64').toString('utf8'));
      return _memCache;
    }
  } catch (e) {}
  _memCache = {};
  return _memCache;
}

async function writeData(data) {
  _memCache = data;
  const content = Buffer.from(JSON.stringify(data)).toString('base64');
  const body = { message: 'update data', content };
  if (_memSha) body.sha = _memSha;
  try {
    const r = await ghRequest('PUT', `/repos/${GH_REPO}/contents/${GH_FILE}`, body);
    if (r.content) _memSha = r.content.sha;
  } catch (e) { console.error('GitHub write failed', e); }
}

// API routes
app.get('/api', async (req, res) => {
  const data = await readData();
  if (req.query.action === 'getAll') return res.json({ ok: true, data });
  const key = req.query.key;
  res.json({ ok: true, value: key ? (data[key] || null) : null });
});

app.post('/api', async (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ ok: false });
  const data = await readData();
  data[key] = value;
  writeData(data);
  res.json({ ok: true });
});

// Serve portal
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Wiom DigiDesk running on port ${PORT}`));
