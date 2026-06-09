const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 8306;

const GH_TOKEN = process.env.GH_TOKEN;
const GH_REPO = 'Wiom-using-AI/wiom-digidesk';
const GH_FILE = 'data.json';
const SLACK_TOKEN = process.env.SLACK_TOKEN;
// Manager name → Slack User ID mapping (add more managers here via SLACK_MGR_IDS env var)
// Format: '{"Pramod":"U07GW5ML467","Rohit":"UXXXXXXX"}'
let SLACK_MGR_IDS = {};
try { SLACK_MGR_IDS = JSON.parse(process.env.SLACK_MGR_IDS || '{"Pramod":"U07GW5ML467"}'); } catch(e) {}

app.use(cors());
app.use(express.json({ limit: '10mb' }));

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
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
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

// ==================== SLACK ====================
function slackDM(userId, text) {
  if (!SLACK_TOKEN || !userId) return Promise.resolve();
  return new Promise((resolve) => {
    const data = JSON.stringify({ channel: userId, text });
    const req = https.request({
      hostname: 'slack.com',
      path: '/api/chat.postMessage',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SLACK_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => { let r=''; res.on('data',c=>r+=c); res.on('end',()=>{ console.log('Slack DM:', r); resolve(); }); });
    req.on('error', e => { console.error('Slack error', e); resolve(); });
    req.write(data);
    req.end();
  });
}

// ==================== CRON (daily 12:30 PM IST = 07:00 UTC) ====================
function startCron() {
  const now = new Date();
  const nextRun = new Date();
  nextRun.setUTCHours(7, 0, 0, 0);
  if (nextRun <= now) nextRun.setUTCDate(nextRun.getUTCDate() + 1);
  const delay = nextRun - now;
  setTimeout(async function tick() {
    await sendDailyAttendance();
    setTimeout(tick, 24 * 60 * 60 * 1000);
  }, delay);
  console.log(`Daily attendance cron scheduled in ${Math.round(delay/60000)} minutes`);
}

async function sendDailyAttendance() {
  if (!SLACK_TOKEN) return;
  try {
    const data = await readData();
    const att = data.wiom_att ? JSON.parse(data.wiom_att) : {};
    const emps = data.wiom_custom_emps ? JSON.parse(data.wiom_custom_emps) : [];
    const todayStr = new Date().toLocaleDateString('en-IN', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
    const todayKey = new Date().toISOString().split('T')[0];

    // Group by manager
    const byMgr = {};
    emps.forEach(e => {
      if (!e.mgr) return;
      if (!byMgr[e.mgr]) byMgr[e.mgr] = [];
      byMgr[e.mgr].push(e);
    });

    // DM each manager individually
    for (const [mgrName, team] of Object.entries(byMgr)) {
      const slackId = SLACK_MGR_IDS[mgrName];
      if (!slackId) { console.log(`No Slack ID for manager: ${mgrName}`); continue; }

      const present = [], absent = [];
      team.forEach(e => {
        const rec = att[`${e.id}_${todayKey}`];
        if (rec && rec.in) present.push(`✅ ${e.name} — In: ${rec.in}`);
        else absent.push(`❌ ${e.name} — Not Marked`);
      });

      const msg = `📋 *Daily Attendance Report — ${todayStr}*\n*Your Team (${team.length} employees)*\n\n${[...present,...absent].join('\n')}\n\n*Present: ${present.length} | Absent: ${absent.length}*`;
      await slackDM(slackId, msg);
    }
    console.log('Daily attendance DMs sent');
  } catch (e) { console.error('Cron error', e); }
}

// ==================== LEAVE NOTIFICATION ====================
app.post('/api/notify-leave', async (req, res) => {
  if (!SLACK_TOKEN) return res.json({ ok: true });
  const { empName, empId, manager, leaveType, from, to, days, reason } = req.body;
  const slackId = SLACK_MGR_IDS[manager];
  if (slackId) {
    const msg = `🏖️ *New Leave Request*\n*Employee:* ${empName} (${empId})\n*Type:* ${leaveType}\n*Dates:* ${from} to ${to} (${days} day${days>1?'s':''})\n*Reason:* ${reason||'—'}\n\n👉 *Approve/Reject:* https://wiom-digidesk-production.up.railway.app`;
    await slackDM(slackId, msg);
  }
  res.json({ ok: true });
});

// ==================== API ROUTES ====================
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

app.listen(PORT, () => {
  console.log(`Wiom DigiDesk running on port ${PORT}`);
  startCron();
});
