const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_STATE_TABLE = process.env.SUPABASE_STATE_TABLE || 'digidesk_state';
const DATA_PATH = process.env.DIGIDESK_DATA_JSON || path.join(__dirname, '..', 'data.json');
const REPLACE = process.argv.includes('--replace');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

function parseLegacyValue(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

async function main() {
  const source = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const keys = Object.keys(source);
  const rows = keys.map(key => ({
    key,
    value: parseLegacyValue(source[key]),
    updated_at: new Date().toISOString()
  }));

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  if (REPLACE) {
    const { data: existingRows, error: selectError } = await supabase.from(SUPABASE_STATE_TABLE).select('key');
    if (selectError) throw selectError;
    const keep = new Set(keys);
    const deleteKeys = (existingRows || []).map(row => row.key).filter(key => !keep.has(key));
    if (deleteKeys.length) {
      const { error: deleteError } = await supabase.from(SUPABASE_STATE_TABLE).delete().in('key', deleteKeys);
      if (deleteError) throw deleteError;
    }
  }

  if (rows.length) {
    const { error } = await supabase.from(SUPABASE_STATE_TABLE).upsert(rows, { onConflict: 'key' });
    if (error) throw error;
  }

  console.log(`Seeded ${rows.length} DigiDesk state keys into ${SUPABASE_STATE_TABLE}.`);
  console.log(keys.map(key => `- ${key}`).join('\n'));
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
