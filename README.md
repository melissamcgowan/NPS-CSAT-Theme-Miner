# NPS/CSAT Open-Text Theme Miner

An interactive web app that turns free-text survey comments into themes, sentiment and a ranked list of what to fix first. It runs entirely in the browser with no build step and no server.

**Live demo:** open `index.html`, or https://melissamcgowan.github.io/NPS-CSAT-Theme-Miner/

> All data in this repo is synthetic. No real customer information is included.

## What it does

| Tab | Question it answers |
|---|---|
| **Overview** | How are we doing, is it improving, and what is driving the score? |
| **Themes** | Which themes are rising or falling over time? |
| **Segments** | Do tiers, products or regions feel different pain? Click a cell to read those comments. |
| **Verbatims** | What did customers actually say? Search, filter by theme and tone, export to CSV. |
| **Priorities** | What should we fix first, who owns it, and what is the first play? Build an action plan and copy it. |
| **Taxonomy** | Edit the keyword rules and watch every comment re-tag live. |

A global **NPS / CSAT** toggle switches the whole app between survey types. Filters for period, tier, product and region apply everywhere, and clicking a month on any trend chart filters the app to that month.

## How it works

Two layers, so a real data source can replace the synthetic one without touching the logic:

```
data.js    raw survey responses (score, comment, tier, product, region, date)
engine.js  tagging, sentiment, NPS/CSAT math, trends, heatmap, priority index
index.html the interface
```

**Theme tagging.** Each theme is a list of keywords matched at the start of a word, so `report` catches "reports" and "reporting". A comment can carry several themes. Rules are used on purpose: every tag is explainable, and the highlighted words in the Verbatims view show exactly what triggered it.

**Sentiment.** Comments are split into clauses (at sentence ends and words like "but" and "however"). Each clause gets a score from a small positive/negative lexicon, with negation handling ("not proactive", "haven't seen an outage"). A theme takes the sentiment of the clause it appears in, so "Support is great but reporting is clunky" tags Support positive and Reporting negative.

**Scores.**
- NPS = % promoters (9 to 10) minus % detractors (0 to 6).
- CSAT = % satisfied (4 to 5).

**Priority index.** Negative mentions of a theme multiplied by how far those customers' average score sits below the overall average. It favors themes that are both common and costly.

## Using your own data

Replace `data.js` with a file that sets `window.NPS_DATA = { responses: [...] }`, where each response has:

```json
{ "id": "R-0001", "date": "2026-03-14", "survey": "NPS", "score": 7,
  "tier": "SMB", "product": "Platform", "region": "NA",
  "account": "A-1001", "comment": "Onboarding was smooth." }
```

`survey` is `"NPS"` (score 0 to 10) or `"CSAT"` (score 1 to 5). Then tune the keywords in the Taxonomy tab. Changes are saved in the browser's local storage.

To regenerate the synthetic data: `python3 generate_data.py`.

## Tests

```
node tests/verify_engine.js     # tagging precision/recall against ground truth
npm i jsdom && node tests/smoke_ui.js   # walks every tab and interaction headlessly
```

Accuracy figures from `verify_engine.js` are measured on the synthetic comments, which were written to be tagged, so treat them as a regression check rather than a real-world accuracy claim. On real verbatims expect lower coverage at first and plan a round or two of keyword tuning using the "Comments with no theme" panel.

## Extending it

- Swap the rule layer for an LLM classifier by replacing `analyzeOne` in `engine.js`. It only needs to return `{ themes: [{id, sent}], sentiment }` per response.
- This project is designed to feed the Unified Customer 360 Dashboard capstone: the theme stats and priority list are plain objects from `themeStats()`.
