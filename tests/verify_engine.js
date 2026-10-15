// Run: node tests/verify_engine.js
// Measures the rule-based tagger against the generator's ground truth.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'data.js'), 'utf8'), sandbox);
const DATA = sandbox.window.NPS_DATA;
const E = require(path.join(root, 'engine.js'));
const truth = JSON.parse(fs.readFileSync(path.join(__dirname, 'truth.json'), 'utf8'));

const compiled = E.compile(E.DEFAULT_TAXONOMY);
const analyzed = E.analyzeAll(DATA.responses, compiled);

let tp = 0, fp = 0, fn = 0, sentOk = 0, sentTotal = 0, polOk = 0, polTotal = 0;
const misses = [];
const perTheme = {};
E.DEFAULT_TAXONOMY.forEach(t => perTheme[t.id] = { tp: 0, fp: 0, fn: 0 });

analyzed.forEach(r => {
  const tr = truth[r.id];
  const got = new Set(r.themes.map(t => t.id));
  const want = new Set(tr.themes);
  want.forEach(id => { if (got.has(id)) { tp++; perTheme[id].tp++; } else { fn++; perTheme[id].fn++; misses.push({ kind: 'miss', id, text: r.comment }); } });
  got.forEach(id => { if (!want.has(id)) { fp++; perTheme[id].fp++; misses.push({ kind: 'extra', id, text: r.comment }); } });
  // theme-level sentiment
  Object.keys(tr.sents || {}).forEach(id => {
    if (got.has(id)) {
      sentTotal++;
      const g = r.themes.find(t => t.id === id).sent;
      if (g === tr.sents[id]) sentOk++;
      else misses.push({ kind: 'sent', id, text: r.comment });
    }
  });
  // comment-level polarity (only for responses with comments and a clear truth)
  if (r.hasComment && tr.polarity !== 0) {
    polTotal++;
    if (r.sentiment === tr.polarity) polOk++;
  }
});

const precision = tp / (tp + fp);
const recall = tp / (tp + fn);
console.log('Theme tagging  precision %s  recall %s', precision.toFixed(3), recall.toFixed(3));
console.log('Theme-level sentiment accuracy %s (%d/%d)', (sentOk / sentTotal).toFixed(3), sentOk, sentTotal);
console.log('Comment polarity accuracy %s (%d/%d)', (polOk / polTotal).toFixed(3), polOk, polTotal);
console.log('Coverage (commented responses with >=1 theme):', JSON.stringify(E.coverage(analyzed)));
Object.keys(perTheme).forEach(id => {
  const p = perTheme[id];
  console.log('  %s  tp=%d fp=%d fn=%d', id.padEnd(13), p.tp, p.fp, p.fn);
});

const seen = new Set();
const sample = misses.filter(m => { const k = m.kind + m.id + m.text; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);
if (sample.length) {
  console.log('\nSample disagreements:');
  sample.forEach(m => console.log(' [%s:%s] %s', m.kind, m.id, m.text));
}

// monthly NPS to sanity check the story in the data
const nps = analyzed.filter(r => r.survey === 'NPS');
const months = E.uniqueSorted(nps.map(r => r.month));
console.log('\nMonthly NPS:', months.map(m => m + ' ' + E.summarize(nps.filter(r => r.month === m), 'NPS').score).join(' | '));
console.log('Overall NPS:', E.summarize(nps, 'NPS').score, ' CSAT %sat:', E.summarize(analyzed.filter(r => r.survey === 'CSAT'), 'CSAT').score);

const pass = precision >= 0.95 && recall >= 0.95 && sentOk / sentTotal >= 0.92;
console.log(pass ? '\nPASS' : '\nBELOW TARGET');
process.exit(pass ? 0 : 1);
