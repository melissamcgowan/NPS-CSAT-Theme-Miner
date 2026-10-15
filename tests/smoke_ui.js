// Run: npm i jsdom && node tests/smoke_ui.js
// Loads index.html in a headless DOM, walks every tab and the main interactions,
// and fails on any runtime error or empty render.
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push(e.message));
vc.on('error', e => errors.push(String(e)));

JSDOM.fromFile(path.join(__dirname, '..', 'index.html'), {
  runScripts: 'dangerously', resources: 'usable', virtualConsole: vc, pretendToBeVisual: true
}).then(dom => {
  const w = dom.window;
  const d = w.document;
  w.scrollTo = () => {}; // jsdom does not implement scrolling
  const results = [];
  function check(name, cond) { results.push([name, !!cond]); }
  function click(sel) { const el = d.querySelector(sel); if (!el) { check('missing ' + sel, false); return; } el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }
  function setSel(bind, val) { const el = d.querySelector('[data-bind="' + bind + '"]'); el.value = val; el.dispatchEvent(new w.Event('change', { bubbles: true })); }
  const main = () => d.querySelector('#main').innerHTML;

  setTimeout(() => {
    check('overview renders KPIs', main().includes('Top priority theme'));
    check('overview trend chart is svg', main().includes('<svg'));

    ['themes', 'segments', 'verbatims', 'priorities', 'taxonomy'].forEach(t => {
      click('[data-act="setTab"][data-v="' + t + '"]');
      check('tab ' + t + ' renders', main().length > 500);
    });

    // CSAT toggle
    click('[data-act="setSurvey"][data-v="CSAT"]');
    click('[data-act="setTab"][data-v="overview"]');
    check('CSAT headline label', main().includes('CSAT (% satisfied)'));
    click('[data-act="setSurvey"][data-v="NPS"]');

    // month pick filters everything
    const before = d.querySelector('.filters .count').textContent;
    click('.col[data-month="2026-06"]');
    const after = d.querySelector('.filters .count').textContent;
    check('month click narrows responses', before !== after);
    click('[data-act="clearFilters"]');

    // themes tab: sort + toggle + table view
    click('[data-act="setTab"][data-v="themes"]');
    click('[data-act="sortTable"][data-k="negRate"]');
    click('[data-act="toggleTheme"][data-theme="csm"]');
    check('theme chip toggles on', d.querySelector('.chip[data-theme="csm"]').getAttribute('aria-pressed') === 'true');
    click('[data-act="trendMode"][data-v="neg"]');
    click('[data-act="toggleTable"][data-chart="themes"]');
    check('table view shows a table', d.querySelector('#main table'));
    click('[data-act="toggleTable"][data-chart="themes"]');

    // segments: dimension + heat cell drill-down
    click('[data-act="setTab"][data-v="segments"]');
    click('[data-act="segDim"][data-v="region"]');
    check('region heatmap has cells', d.querySelectorAll('td.cell').length >= 8 * 3);
    click('td.cell[data-theme="support"]');
    check('cell click jumps to verbatims', d.querySelector('#vlist') && d.querySelector('.tabs [aria-selected="true"]').textContent === 'Verbatims');
    check('cell click applies filter', d.querySelector('[data-bind="region"]').value !== '');
    click('[data-act="clearFilters"]');

    // verbatims: search + sentiment + more
    click('[data-act="vTheme"][data-theme=""]'); setSel('vSent', '');
    const s = d.querySelector('#vSearch');
    s.value = 'sync'; s.dispatchEvent(new w.Event('input', { bubbles: true }));
    check('search filters list', d.querySelector('#vlist').textContent.toLowerCase().includes('sync'));
    s.value = ''; s.dispatchEvent(new w.Event('input', { bubbles: true }));
    click('[data-act="vTheme"][data-theme="reporting"]');
    setSel('vSent', 'neg');
    check('theme+tone filter yields tagged comments', d.querySelectorAll('.verb').length > 0);
    check('highlight marks present', d.querySelectorAll('mark').length > 0);
    click('[data-act="vMore"]');

    // priorities: details + plan
    click('[data-act="setTab"][data-v="priorities"]');
    click('[data-act="toggleOpen"]');
    check('detail panel opens', d.querySelector('.detail'));
    const cb = d.querySelector('input[data-act="togglePlan"]');
    cb.checked = true; cb.dispatchEvent(new w.Event('change', { bubbles: true }));
    check('plan lists chosen theme', d.querySelector('#main ol'));

    // taxonomy: edit keywords live, add/reset
    click('[data-act="setTab"][data-v="taxonomy"]');
    const covBefore = d.querySelector('#covBox').textContent;
    const ta = d.querySelector('textarea[data-tax="keywords"]');
    ta.value = ''; ta.dispatchEvent(new w.Event('input', { bubbles: true }));
    const covAfter = d.querySelector('#covBox').textContent;
    check('removing keywords lowers coverage', covBefore !== covAfter);
    const tester = d.querySelector('#tester');
    tester.value = 'Support is great but reporting is clunky';
    tester.dispatchEvent(new w.Event('input', { bubbles: true }));
    check('tester tags support + reporting', d.querySelector('#testOut').textContent.includes('Support Responsiveness') && d.querySelector('#testOut').textContent.includes('Reporting & Analytics'));
    click('[data-act="addTheme"]');
    check('add theme appends editor', d.querySelectorAll('.edit').length === 9);
    click('[data-act="resetTax"]');
    check('reset restores 8 themes', d.querySelectorAll('.edit').length === 8);

    // empty filter state
    click('[data-act="setTab"][data-v="overview"]');
    setSel('from', '2026-10'); setSel('to', '2025-11');
    check('from>to is corrected, not empty', !main().includes('No responses match'));
    click('[data-act="clearFilters"]');

    check('no runtime errors', errors.length === 0);
    let bad = 0;
    results.forEach(([n, ok]) => { if (!ok) { bad++; console.log('FAIL', n); } });
    console.log(results.length - bad + '/' + results.length + ' checks passed');
    if (errors.length) console.log('Runtime errors:\n' + errors.join('\n'));
    process.exit(bad || errors.length ? 1 : 0);
  }, 400);
});
