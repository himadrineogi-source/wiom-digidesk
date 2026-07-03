import { createClient } from '@supabase/supabase-js';

const GH_REPO = 'Wiom-using-AI/wiom-digidesk';
const GH_FILE = 'data.json';
const DEFAULT_STATE_TABLE = 'digidesk_state';

let supabaseClient = null;
let githubSha = null;
let githubWriteQueue = Promise.resolve();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cloneData(data) {
  return JSON.parse(JSON.stringify(data || {}));
}

export function getDataBackend() {
  return process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? 'supabase'
    : 'github';
}

function getStateTable() {
  return process.env.SUPABASE_STATE_TABLE || DEFAULT_STATE_TABLE;
}

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  if (!supabaseClient) {
    supabaseClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }

  return supabaseClient;
}

export function parseLegacyValue(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function stringifyStoredValue(value) {
  return JSON.stringify(value);
}

async function githubRequest(method, path, body) {
  if (!process.env.GH_TOKEN) {
    throw new Error('Missing GH_TOKEN for GitHub data fallback');
  }

  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `token ${process.env.GH_TOKEN}`,
      'User-Agent': 'wiom-digidesk',
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function readSupabaseData() {
  const { data, error } = await getSupabase().from(getStateTable()).select('key,value');
  if (error) throw error;

  const state = {};
  (data || []).forEach(row => {
    state[row.key] = stringifyStoredValue(row.value);
  });
  return state;
}

async function readGithubData() {
  const response = await githubRequest('GET', `/repos/${GH_REPO}/contents/${GH_FILE}`);
  if (!response.content) return {};

  githubSha = response.sha;
  return JSON.parse(Buffer.from(response.content, 'base64').toString('utf8'));
}

export async function readData() {
  if (getDataBackend() === 'supabase') {
    return cloneData(await readSupabaseData());
  }

  return cloneData(await readGithubData());
}

async function writeSupabaseData(snapshot) {
  const keys = Object.keys(snapshot);
  const rows = keys.map(key => ({
    key,
    value: parseLegacyValue(snapshot[key]),
    updated_at: new Date().toISOString()
  }));

  const { data: existingRows, error: selectError } = await getSupabase()
    .from(getStateTable())
    .select('key');
  if (selectError) throw selectError;

  const keep = new Set(keys);
  const deleteKeys = (existingRows || []).map(row => row.key).filter(key => !keep.has(key));
  if (deleteKeys.length) {
    const { error: deleteError } = await getSupabase()
      .from(getStateTable())
      .delete()
      .in('key', deleteKeys);
    if (deleteError) throw deleteError;
  }

  if (rows.length) {
    const { error: upsertError } = await getSupabase()
      .from(getStateTable())
      .upsert(rows, { onConflict: 'key' });
    if (upsertError) throw upsertError;
  }

  return true;
}

async function writeGithubData(snapshot) {
  return githubWriteQueue = githubWriteQueue.then(async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const current = await githubRequest('GET', `/repos/${GH_REPO}/contents/${GH_FILE}`);
        if (current.sha) githubSha = current.sha;
      } catch {}

      const body = {
        message: 'update data',
        content: Buffer.from(JSON.stringify(snapshot)).toString('base64')
      };
      if (githubSha) body.sha = githubSha;

      try {
        const result = await githubRequest('PUT', `/repos/${GH_REPO}/contents/${GH_FILE}`, body);
        if (result.content) {
          githubSha = result.content.sha;
          return true;
        }
      } catch (error) {
        console.error('GitHub write attempt failed:', error?.message);
      }

      if (attempt < 4) await sleep((attempt + 1) * 2000);
    }

    return false;
  }).catch(error => {
    console.error('GitHub write queue error:', error?.message);
    return false;
  });
}

export async function writeData(data) {
  const snapshot = cloneData(data);
  if (getDataBackend() === 'supabase') {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await writeSupabaseData(snapshot);
      } catch (error) {
        console.error('Supabase write attempt failed:', error?.message);
      }
      if (attempt < 2) await sleep((attempt + 1) * 1000);
    }
    return false;
  }

  return writeGithubData(snapshot);
}

export async function setDataKey(key, value) {
  if (getDataBackend() === 'supabase') {
    const { error } = await getSupabase()
      .from(getStateTable())
      .upsert({
        key,
        value: parseLegacyValue(value),
        updated_at: new Date().toISOString()
      }, { onConflict: 'key' });

    if (error) throw error;
    return true;
  }

  const data = await readData();
  data[key] = typeof value === 'string' ? value : JSON.stringify(value);
  return writeData(data);
}

export async function updateDataKey(key, fallback, updater) {
  const data = await readData();
  const current = data[key] ? JSON.parse(data[key]) : fallback;
  const next = await updater(current, data);
  const saved = await setDataKey(key, next);
  return { value: next, saved };
}
