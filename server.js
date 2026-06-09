const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 8306;

const GH_TOKEN = process.env.GH_TOKEN;
const GH_REPO = 'Wiom-using-AI/wiom-digidesk';
const GH_FILE = 'data.json';
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK; // e.g. https://hooks.slack.com/services/...

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
function slackPost(payload) {
  if (!SLACK_WEBHOOK) return;
  const webhookPath = SLACK_WEBHOOK.replace('https://hooks.slack.com', '');
  const data = JSON.stringify(payload);
  const req = https.request({
    hostname: 'hooks.slack.com',
    path: webhookPath,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
  }, () => {});
  req.on('error', e => console.error('Slack error', e));
  req.write(data);
  req.end();
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
  if (!SLACK_WEBHOOK) return;
  try {
    const data = await readData();
    const att = data.wiom_att ? JSON.parse(data.wiom_att) : {};
    const emps = data.wiom_custom_emps ? JSON.parse(data.wiom_custom_emps) : [];
    const today = new Date().toISOString().split('T')[0];

    // Group employees by manager
    const byMgr = {};
    emps.forEach(e => {
      if (!e.mgr) return;
      if (!byMgr[e.mgr]) byMgr[e.mgr] = [];
      byMgr[e.mgr].push(e);
    });

    // Send one message per manager (all in one webhook message)
    const allLines = [];
    Object.entries(byMgr).forEach(([mgr, team]) => {
      allLines.push(`*Manager: ${mgr}*`);
      team.forEach(e => {
        const key = `${e.id}_${today}`;
        const rec = att[key];
        const status = rec && rec.in ? `✅ Checked In at ${rec.in}` : `❌ Not Marked`;
        allLines.push(`  • ${e.name} (${e.id}) — ${status}`);
      });
      allLines.push('');
    });

    if (allLines.length === 0) {
      slackPost({ text: `📋 *Daily Attendance Report — ${today}*\nNo employees found.` });
      return;
    }

    slackPost({
      text: `📋 *Daily Attendance Report — ${today}*\n\n${allLines.join('\n')}`
    });
    console.log('Daily attendance sent to Slack');
  } catch (e) { console.error('Cron error', e); }
}

// ==================== LEAVE NOTIFICATION ====================
app.post('/api/notify-leave', async (req, res) => {
  if (!SLACK_WEBHOOK) return res.json({ ok: true });
  const { empName, empId, manager, leaveType, from, to, days, reason } = req.body;
  slackPost({
    text: `🏖️ *New Leave Request*\n*Employee:* ${empName} (${empId})\n*Manager:* ${manager}\n*Type:* ${leaveType}\n*Dates:* ${from} to ${to} (${days} day${days>1?'s':''})\n*Reason:* ${reason||'—'}\n\n👉 Approve/Reject here: https://wiom-digidesk-production.up.railway.app`
  });
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
