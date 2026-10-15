/*
 * Theme Miner engine (layer 2): pure functions, no DOM.
 *
 *  - rule-based theme tagging from an editable keyword taxonomy
 *  - clause-level sentiment with simple negation handling
 *  - NPS / CSAT summaries, theme stats, trends, heatmaps, priority index
 *
 * Works in the browser (window.NPSEngine) and in Node (module.exports) so it can be tested.
 */
(function (root) {
  'use strict';

  var DEFAULT_TAXONOMY = [
    { id: 'onboarding', name: 'Onboarding & Training', keywords: ['onboard', 'training', 'implementation', 'kickoff', 'setup', 'set up', 'getting started', 'ramp', 'documentation', 'tutorial'] },
    { id: 'usability', name: 'Product Usability', keywords: ['easy to use', 'intuitive', 'confusing', 'clunky', 'navigat', 'interface', 'ui', 'workflow', 'learning curve', 'cluttered'] },
    { id: 'reporting', name: 'Reporting & Analytics', keywords: ['report', 'dashboard', 'analytics', 'export', 'visualization', 'metrics', 'insight'] },
    { id: 'integrations', name: 'Integrations', keywords: ['integration', 'integrate', 'salesforce', 'api', 'connector', 'sync', 'hubspot', 'zendesk', 'slack'] },
    { id: 'performance', name: 'Performance & Reliability', keywords: ['slow', 'lag', 'outage', 'downtime', 'crash', 'bug', 'reliab', 'uptime', 'error', 'timeout', 'time out', 'load', 'performance', 'stabil'] },
    { id: 'support', name: 'Support Responsiveness', keywords: ['support', 'ticket', 'response time', 'escalat', 'helpdesk', 'resolved', 'turnaround', 'waiting on'] },
    { id: 'pricing', name: 'Pricing & Value', keywords: ['price', 'pricing', 'cost', 'expensive', 'renewal increase', 'value for money', 'contract', 'budget', 'discount'] },
    { id: 'csm', name: 'CSM Relationship', keywords: ['csm', 'account manager', 'success manager', 'check-in', 'proactive', 'strategic', 'partner', 'relationship', 'advisor'] }
  ];

  // Where each theme's follow-up usually lands. Used by the Priorities view.
  var PLAYS = {
    onboarding: { owner: 'CS Onboarding / Enablement', play: 'Refresh the kickoff checklist, add a day-14 check-in, and publish role-based training paths.' },
    usability: { owner: 'Product + UX Research', play: 'Run 5 customer walkthroughs on the top confusing screens and share clips with the product team.' },
    reporting: { owner: 'Product, Analytics', play: 'Collect the 5 most-requested missing metrics and offer a custom-report workshop to affected accounts.' },
    integrations: { owner: 'Solutions Engineering', play: 'Audit failing syncs by connector, publish a known-issues page, and assign an integration owner per at-risk account.' },
    performance: { owner: 'Engineering / SRE + CS', play: 'Send a proactive incident recap to affected accounts and agree a reliability target to report on monthly.' },
    support: { owner: 'Support Operations', play: 'Review escalation SLAs, add follow-the-sun coverage where regions lag, and close the loop on open tickets.' },
    pricing: { owner: 'CS Leadership + Finance', play: 'Pre-brief renewals 90 days out with value summaries and pre-approve save offers for at-risk accounts.' },
    csm: { owner: 'CS Management', play: 'Set a minimum touch cadence, protect continuity during reassignments, and add proactive strategic reviews.' }
  };

  var POS = new Set(('great excellent love loved loves easy helpful fast responsive reliable reliably intuitive smooth ' +
    'improved fantastic valuable proactive clear seamless seamlessly impressed impressive solid happy quick quickly thorough ' +
    'outstanding best save saves saved powerful perfectly good fair flexible generous friendly knowledgeable well ' +
    'straightforward recommend wonderful amazing stable clean organized').split(/\s+/));

  var NEG = new Set(('slow confusing clunky frustrating frustrated poor disappointed disappointing difficult unreliable ' +
    'outage outages broken bug bugs expensive lacking lack missing painful delay delayed delays waiting worse terrible hard ' +
    'cluttered limited crash crashes lag laggy error errors unresponsive complicated overpriced issue issues problem problems ' +
    'failed fails failing unhelpful outdated overwhelming dragged rushed disorganized strained rigid rarely cannot hurt ' +
    'poorly shallow slipping breaks climbing complaints annoying painfully').split(/\s+/));

  var NEGATORS = new Set(['no', 'not', 'never', 'without', 'hardly', 'neither', 'nor']);
  var STOPS = new Set(['and', 'or', 'but', 'so', 'because', 'while']);

  function isNegator(tok) {
    return NEGATORS.has(tok) || /n't$/.test(tok);
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function compile(taxonomy) {
    return taxonomy.map(function (t) {
      var kws = (t.keywords || []).map(function (k) { return k.trim().toLowerCase(); }).filter(Boolean);
      return {
        id: t.id,
        name: t.name,
        keywords: kws,
        res: kws.map(function (k) { return new RegExp('\\b' + escapeRe(k)); })
      };
    });
  }

  function tokens(s) {
    return s.toLowerCase().match(/[a-z']+/g) || [];
  }

  function clauseSentiment(text) {
    var t = tokens(text);
    var sum = 0;
    for (var i = 0; i < t.length; i++) {
      var v = POS.has(t[i]) ? 1 : (NEG.has(t[i]) ? -1 : 0);
      if (!v) continue;
      // Look back up to 3 tokens for a negator, but never across a conjunction.
      for (var j = i - 1; j >= Math.max(0, i - 3); j--) {
        if (STOPS.has(t[j])) break;
        if (isNegator(t[j])) { v = -v; break; }
      }
      sum += v;
    }
    return sum;
  }

  function splitClauses(text) {
    return text.split(/[.;!?]+|\s(?:but|however|although|though)\s/i)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function analyzeOne(r, compiled) {
    var text = (r.comment || '').trim();
    var out = Object.assign({}, r, { themes: [], sentiment: 0, hasComment: !!text, month: r.date.slice(0, 7) });
    if (!text) return out;
    var total = 0;
    var cds = splitClauses(text).map(function (c) {
      var lc = c.toLowerCase();
      var s = clauseSentiment(c);
      total += s;
      var hit = [];
      compiled.forEach(function (t) {
        if (t.res.some(function (re) { return re.test(lc); })) hit.push(t.id);
      });
      return { s: s, hit: hit };
    });
    var map = {};
    cds.forEach(function (cd) {
      // A clause with no sentiment words inherits the comment's overall mood.
      var sg = cd.s !== 0 ? Math.sign(cd.s) : Math.sign(total);
      cd.hit.forEach(function (id) { map[id] = (map[id] || 0) + sg; });
    });
    out.themes = Object.keys(map).map(function (id) { return { id: id, sent: Math.sign(map[id]) }; });
    out.sentiment = Math.sign(total);
    return out;
  }

  function analyzeAll(responses, compiled) {
    return responses.map(function (r) { return analyzeOne(r, compiled); });
  }

  function themeSent(r, id) {
    for (var i = 0; i < r.themes.length; i++) if (r.themes[i].id === id) return r.themes[i].sent;
    return null;
  }

  /* ---------- scores ---------- */

  function scoreCat(r) {
    if (r.survey === 'NPS') return r.score >= 9 ? 'pro' : (r.score >= 7 ? 'pas' : 'det');
    return r.score >= 4 ? 'pro' : (r.score === 3 ? 'pas' : 'det');
  }

  // NPS headline = %promoters - %detractors. CSAT headline = % satisfied (4-5).
  function summarize(list, survey) {
    var n = list.length;
    var out = { n: n, score: null, avg: null, pro: 0, pas: 0, det: 0, proP: 0, pasP: 0, detP: 0 };
    if (!n) return out;
    var sum = 0;
    list.forEach(function (r) {
      var c = scoreCat(r);
      out[c]++;
      sum += r.score;
    });
    out.avg = sum / n;
    out.proP = out.pro / n; out.pasP = out.pas / n; out.detP = out.det / n;
    out.score = survey === 'NPS' ? Math.round((out.pro - out.det) / n * 100) : Math.round(out.pro / n * 100);
    return out;
  }

  function uniqueSorted(arr) {
    return Array.from(new Set(arr)).sort();
  }

  /* ---------- themes ---------- */

  function trendWindow(list) {
    var months = uniqueSorted(list.filter(function (r) { return r.hasComment; }).map(function (r) { return r.month; }));
    if (months.length < 4) return null;
    var k = Math.min(3, Math.floor(months.length / 2));
    return { recent: months.slice(-k), prior: months.slice(-2 * k, -k) };
  }

  function shareOf(list, months, id, onlyNeg) {
    var c = list.filter(function (r) { return r.hasComment && months.indexOf(r.month) >= 0; });
    if (!c.length) return 0;
    var m = c.filter(function (r) {
      var s = themeSent(r, id);
      return s !== null && (!onlyNeg || s < 0);
    });
    return m.length / c.length * 100;
  }

  function themeStats(list, tax, survey) {
    var commented = list.filter(function (r) { return r.hasComment; });
    var base = summarize(list, survey);
    var range = survey === 'NPS' ? 10 : 4;
    var tw = trendWindow(list);
    return tax.map(function (t) {
      var m = commented.filter(function (r) { return themeSent(r, t.id) !== null; });
      var neg = m.filter(function (r) { return themeSent(r, t.id) < 0; });
      var pos = m.filter(function (r) { return themeSent(r, t.id) > 0; });
      var ms = summarize(m, survey);
      var ns = summarize(neg, survey);
      var gap = (neg.length && base.avg !== null) ? Math.max(0, base.avg - ns.avg) / range : 0;
      var recent = tw ? shareOf(list, tw.recent, t.id, false) : null;
      var prior = tw ? shareOf(list, tw.prior, t.id, false) : null;
      var negRecent = tw ? shareOf(list, tw.recent, t.id, true) : null;
      var negPrior = tw ? shareOf(list, tw.prior, t.id, true) : null;
      return {
        id: t.id,
        name: t.name,
        mentions: m.length,
        neg: neg.length,
        pos: pos.length,
        neu: m.length - neg.length - pos.length,
        share: commented.length ? m.length / commented.length * 100 : 0,
        negRate: m.length ? neg.length / m.length * 100 : 0,
        score: ms.score,
        avg: ms.avg,
        negAvg: ns.avg,
        delta: (ms.score !== null && base.score !== null) ? ms.score - base.score : null,
        gap: gap,
        priority: neg.length * gap,
        shareChange: recent !== null ? recent - prior : null,
        negChange: negRecent !== null ? negRecent - negPrior : null,
        recentShare: recent,
        recentNeg: negRecent
      };
    });
  }

  // mode: 'share' = % of commented responses mentioning the theme; 'neg' = % mentioning it negatively
  function themeSeries(list, tax, months, mode) {
    var out = {};
    tax.forEach(function (t) { out[t.id] = []; });
    months.forEach(function (mo) {
      var c = list.filter(function (r) { return r.hasComment && r.month === mo; });
      tax.forEach(function (t) {
        if (!c.length) { out[t.id].push(null); return; }
        var k = c.filter(function (r) {
          var s = themeSent(r, t.id);
          return s !== null && (mode === 'neg' ? s < 0 : true);
        }).length;
        out[t.id].push(k / c.length * 100);
      });
    });
    return out;
  }

  /* ---------- segments ---------- */

  function dimValues(list, dim) {
    return uniqueSorted(list.map(function (r) { return r[dim]; }));
  }

  function heat(list, tax, dim, survey) {
    var vals = dimValues(list, dim);
    var segs = vals.map(function (v) {
      var sub = list.filter(function (r) { return r[dim] === v; });
      return { value: v, n: sub.length, commented: sub.filter(function (r) { return r.hasComment; }).length, summary: summarize(sub, survey) };
    });
    var rows = tax.map(function (t) {
      var cells = vals.map(function (v) {
        var sub = list.filter(function (r) { return r[dim] === v && r.hasComment; });
        var m = sub.filter(function (r) { return themeSent(r, t.id) !== null; });
        var neg = m.filter(function (r) { return themeSent(r, t.id) < 0; });
        return {
          value: v,
          mentions: m.length,
          neg: neg.length,
          share: sub.length ? m.length / sub.length * 100 : 0,
          negShare: sub.length ? neg.length / sub.length * 100 : 0,
          negRate: m.length ? neg.length / m.length * 100 : null
        };
      });
      return { id: t.id, name: t.name, cells: cells };
    });
    return { segments: segs, rows: rows };
  }

  /* ---------- coverage ---------- */

  function coverage(list) {
    var c = list.filter(function (r) { return r.hasComment; });
    var tagged = c.filter(function (r) { return r.themes.length > 0; });
    return { commented: c.length, tagged: tagged.length, pct: c.length ? Math.round(tagged.length / c.length * 100) : 0 };
  }

  function csvEscape(v) {
    var s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(list, nameOf) {
    var head = ['id', 'date', 'survey', 'score', 'tier', 'product', 'region', 'account', 'sentiment', 'themes', 'comment'];
    var rows = list.map(function (r) {
      var sent = r.sentiment > 0 ? 'positive' : (r.sentiment < 0 ? 'negative' : 'neutral');
      var themes = r.themes.map(function (t) { return nameOf(t.id) + (t.sent > 0 ? ' (+)' : t.sent < 0 ? ' (-)' : ''); }).join('; ');
      return [r.id, r.date, r.survey, r.score, r.tier, r.product, r.region, r.account, sent, themes, r.comment].map(csvEscape).join(',');
    });
    return head.join(',') + '\n' + rows.join('\n');
  }

  var api = {
    DEFAULT_TAXONOMY: DEFAULT_TAXONOMY,
    PLAYS: PLAYS,
    compile: compile,
    analyzeOne: analyzeOne,
    analyzeAll: analyzeAll,
    clauseSentiment: clauseSentiment,
    scoreCat: scoreCat,
    summarize: summarize,
    themeSent: themeSent,
    themeStats: themeStats,
    themeSeries: themeSeries,
    heat: heat,
    dimValues: dimValues,
    coverage: coverage,
    trendWindow: trendWindow,
    uniqueSorted: uniqueSorted,
    toCsv: toCsv
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NPSEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
