#!/usr/bin/env python3
"""
Synthetic NPS / CSAT survey generator for the Theme Miner.

Layer 1 of the two-layer design: this script produces raw survey responses
(score + free-text verbatim + segment fields). It knows nothing about the
theme taxonomy. The engine tags themes from the text in the browser.

Outputs
  data.js              window.NPS_DATA, loaded by index.html
  tests/truth.json     ground-truth themes/polarity per response, used only by
                       tests/verify_engine.js to measure tagging accuracy

Swap this layer for a real survey export (same fields) and the app keeps working.
"""
import datetime
import json
import os
import random

random.seed(2026)

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------------------
# Phrase library: one clause per phrase. Each carries its own sentiment words.
# ---------------------------------------------------------------------------
PHRASES = {
    "onboarding": {
        "neg": [
            "Onboarding was painful and the implementation timeline kept slipping",
            "The training was poor and getting started felt overwhelming",
            "Documentation was lacking during setup and we were left to figure things out",
            "The kickoff was disorganized and the ramp up was frustrating",
            "The tutorials are outdated and onboarding was difficult",
        ],
        "pos": [
            "Onboarding was smooth and the training was excellent",
            "Implementation went great and the kickoff was well organized",
            "Getting started was easy thanks to the clear documentation",
            "The setup was seamless and the team ramped up quickly",
            "Loved the training sessions, very helpful",
        ],
    },
    "usability": {
        "neg": [
            "The interface is cluttered and navigation is confusing",
            "The workflow feels clunky and there is a steep learning curve",
            "Too many clicks to do simple things, the UI is frustrating",
            "Navigating between screens is difficult and the layout is confusing",
            "The workflow is complicated for new users",
        ],
        "pos": [
            "The platform is intuitive and easy to use",
            "Love the clean interface, it is simple to navigate",
            "The workflow is smooth and saves our team time",
            "Very intuitive, even new teammates picked it up fast",
        ],
    },
    "reporting": {
        "neg": [
            "Reporting is limited and exports are missing key fields",
            "The dashboards lack the metrics we need for our execs",
            "Custom reports are hard to build and the analytics feel shallow",
            "We cannot get the insight we need without exporting everything to spreadsheets",
        ],
        "pos": [
            "The dashboards are great and the reports save us hours",
            "Analytics are powerful and the insight we get is valuable",
            "Love the new dashboard, the visualizations are clear",
            "Export options are excellent and custom reports are easy to build",
        ],
    },
    "integrations": {
        "neg": [
            "The Salesforce integration breaks often and the sync is unreliable",
            "We need more connectors and the API is poorly documented",
            "HubSpot integration is missing fields and syncing fails",
            "Setting up the Slack integration was frustrating",
        ],
        "pos": [
            "The Salesforce integration works great and data syncs perfectly",
            "API is well documented and the connectors cover everything we use",
            "Integration with Zendesk and Slack was seamless",
            "Love how the HubSpot sync keeps everything up to date",
        ],
    },
    "performance": {
        "neg": [
            "The platform is slow during peak hours and pages time out",
            "We had two outages this quarter and it hurt our team",
            "Too many bugs after each release and frequent crashes",
            "Loading times are terrible and we keep seeing errors",
        ],
        "pos": [
            "Uptime has been excellent and the platform is fast",
            "Very reliable, no downtime that we have noticed",
            "Performance improved a lot and pages load quickly",
            "Rock solid stability, haven't seen an outage",
        ],
    },
    "support": {
        "neg": [
            "Support response time is terrible and tickets sit for days",
            "We keep waiting on support to resolve escalations",
            "The helpdesk was unhelpful and our issue was never resolved",
            "Escalations take too long and turnaround is disappointing",
        ],
        "pos": [
            "Support is fantastic and tickets get resolved quickly",
            "Great response time from support, they always follow through",
            "The support team is responsive and knowledgeable",
            "Escalations were handled fast and the turnaround was impressive",
        ],
    },
    "pricing": {
        "neg": [
            "Pricing is too expensive for the value we get",
            "The renewal increase was a surprise and it strained our budget",
            "Contract terms are rigid and discounts are hard to come by",
            "Costs keep climbing and it feels overpriced",
        ],
        "pos": [
            "Pricing is fair and the value for money is excellent",
            "Good value for money and the renewal terms were flexible",
            "The contract was straightforward and they offered a generous discount",
            "Budget friendly compared to alternatives",
        ],
    },
    "csm": {
        "neg": [
            "My CSM is hard to reach and check-ins feel like a formality",
            "We rarely hear from our account manager unless it is renewal time",
            "The success manager is not proactive and rarely offers strategic advice",
            "Our CSM changed twice this year and the lack of continuity is frustrating",
        ],
        "pos": [
            "My CSM is proactive and a true strategic partner",
            "Our success manager is outstanding and the check-ins are valuable",
            "Great relationship with our account manager, always helpful",
            "The CSM goes above and beyond and offers excellent advice",
        ],
    },
}

GENERIC = {
    "pos": ["Overall pretty happy", "Would recommend to a peer", "Happy with the overall experience", "No complaints"],
    "neu": ["It does the job", "Not sure what to say", "Fine for now"],
    "neg": ["Disappointed overall", "Not what we hoped for"],
}

THEMES = list(PHRASES.keys())

MONTHS = [(2025, 11), (2025, 12)] + [(2026, m) for m in range(1, 11)]  # Nov 2025 .. Oct 2026
LAST_DATE = datetime.date(2026, 10, 12)


def lerp(a, b, t):
    return a + (b - a) * t


def theme_weight(theme, m, tier, product, region):
    """Relative chance a response mentions this theme in month index m (0..11)."""
    t = m / 11.0
    w = {
        "onboarding": lerp(1.25, 0.8, t),
        "usability": 1.0,
        "reporting": lerp(0.8, 1.6, t),
        "integrations": 1.0,
        "performance": 2.3 if m in (6, 7) else 0.7,
        "support": 1.1,
        "pricing": lerp(0.6, 1.2, max(0, (m - 8) / 3.0)) if m >= 8 else 0.6,
        "csm": 0.8,
    }[theme]
    if tier == "Enterprise" and theme in ("integrations", "reporting"):
        w *= 1.5
    if tier == "SMB" and theme in ("pricing", "onboarding"):
        w *= 1.6
    if tier == "Mid-Market" and theme == "usability":
        w *= 1.4
    if product == "Analytics" and theme == "reporting":
        w *= 2.0
    if product == "Integrations" and theme in ("integrations", "performance"):
        w *= 1.8
    if product == "Platform" and theme == "usability":
        w *= 1.3
    if region == "APAC" and theme == "support":
        w *= 1.6
    return w


def neg_prob(theme, m, tier, region):
    t = m / 11.0
    p = {
        "onboarding": lerp(0.65, 0.3, min(1, max(0, (m - 3) / 5.0))),
        "usability": 0.45,
        "reporting": lerp(0.45, 0.75, t),
        "integrations": 0.5,
        "performance": 0.85 if m in (6, 7) else 0.35,
        "support": 0.6 if m <= 7 else 0.3,
        "pricing": 0.7,
        "csm": 0.3,
    }[theme]
    if region == "APAC" and theme == "support":
        p = min(0.9, p + 0.2)
    if tier == "SMB" and theme == "pricing":
        p = min(0.9, p + 0.1)
    # gentle overall lift so the program tells an improving story (incident months stay rough)
    return p if m in (6, 7) else p * 0.8


def pick(weights):
    items = list(weights.items())
    total = sum(w for _, w in items)
    r = random.random() * total
    acc = 0
    for k, w in items:
        acc += w
        if r <= acc:
            return k
    return items[-1][0]


def weighted(choices):
    return pick({k: v for k, v in choices})


def lower_first(s):
    keep = ("CSM", "API", "UI", "HubSpot", "Salesforce", "Zendesk", "Slack", "Support", "Escalations", "Pricing", "Costs", "Contract", "Reporting", "Custom", "Export", "Analytics", "Integration", "Onboarding", "Documentation", "Loved", "Love", "Performance", "Uptime", "Rock", "Very", "Good", "Great", "Budget", "My", "Our", "The", "We", "Too", "Setting", "Loading", "Navigating", "Getting", "Implementation", "Overall", "Would", "Happy", "No", "It", "Not", "Fine", "Disappointed")
    first = s.split(" ")[0]
    if first in keep:
        if first in ("CSM", "API", "UI", "HubSpot", "Salesforce", "Zendesk", "Slack"):
            return s
        return first.lower() + s[len(first):]
    return s


def build_comment(m, tier, product, region):
    """Returns (comment, themes_truth, polarity) where polarity is -1/0/1 overall."""
    r = random.random()
    if r < 0.10:
        kind = random.choice(["pos", "pos", "neu", "neg"])
        return random.choice(GENERIC[kind]) + ".", [], {"pos": 1, "neu": 0, "neg": -1}[kind]

    n_themes = 2 if random.random() < 0.30 else 1
    weights = {t: theme_weight(t, m, tier, product, region) for t in THEMES}
    chosen = []
    for _ in range(n_themes):
        t = pick({k: v for k, v in weights.items() if k not in chosen})
        chosen.append(t)

    clauses = []
    sents = {}
    for t in chosen:
        neg = random.random() < neg_prob(t, m, tier, region)
        sents[t] = -1 if neg else 1
        clauses.append((t, random.choice(PHRASES[t]["neg" if neg else "pos"]), -1 if neg else 1))

    if len(clauses) == 1:
        text = clauses[0][1] + "."
    else:
        (t1, c1, s1), (t2, c2, s2) = clauses
        if s1 != s2:
            text = c1 + ", but " + lower_first(c2) + "."
        elif random.random() < 0.5:
            text = c1 + " and " + lower_first(c2) + "."
        else:
            text = c1 + ". " + c2 + "."

    net = sum(sents.values()) / len(sents)
    polarity = 1 if net > 0 else (-1 if net < 0 else 0)
    return text, chosen, sents, polarity


def nps_score(polarity):
    if polarity > 0:
        return weighted([(10, 50), (9, 30), (8, 15), (7, 5)])
    if polarity < 0:
        return weighted([(0, 3), (1, 3), (2, 5), (3, 8), (4, 12), (5, 20), (6, 25), (7, 14), (8, 10)])
    return weighted([(5, 10), (6, 25), (7, 30), (8, 25), (9, 10)])


def csat_score(polarity):
    if polarity > 0:
        return weighted([(5, 60), (4, 35), (3, 5)])
    if polarity < 0:
        return weighted([(1, 20), (2, 45), (3, 30), (4, 5)])
    return weighted([(2, 25), (3, 50), (4, 25)])


def random_date(year, month):
    start = datetime.date(year, month, 1)
    nxt = datetime.date(year + (month == 12), (month % 12) + 1, 1)
    end = min(nxt - datetime.timedelta(days=1), LAST_DATE)
    span = (end - start).days
    return start + datetime.timedelta(days=random.randint(0, span))


def main():
    responses = []
    truth = {}
    rid = 1
    for m, (year, month) in enumerate(MONTHS):
        growth = 1 + 0.025 * m
        for survey, base_n in (("NPS", 40), ("CSAT", 27)):
            n = int(base_n * growth) + random.randint(-4, 4)
            if (year, month) == (2026, 10):
                n = int(n * 0.45)  # partial month
            for _ in range(n):
                tier = weighted([("Enterprise", 30), ("Mid-Market", 35), ("SMB", 35)])
                product = weighted([("Platform", 50), ("Analytics", 30), ("Integrations", 20)])
                region = weighted([("NA", 55), ("EMEA", 30), ("APAC", 15)])

                if random.random() < 0.12:
                    # blank comment: score from a baseline mood
                    pol = weighted([(1, 45), (0, 30), (-1, 25)])
                    comment, themes_t, sents = "", [], {}
                else:
                    out = build_comment(m, tier, product, region)
                    if len(out) == 3:
                        comment, themes_t, pol = out
                        sents = {}
                    else:
                        comment, themes_t, sents, pol = out

                score = nps_score(pol) if survey == "NPS" else csat_score(pol)
                d = random_date(year, month)
                responses.append({
                    "id": "R-%04d" % rid,
                    "date": d.isoformat(),
                    "survey": survey,
                    "score": score,
                    "tier": tier,
                    "product": product,
                    "region": region,
                    "account": "A-%04d" % random.randint(1000, 1299),
                    "comment": comment,
                })
                truth["R-%04d" % rid] = {"themes": themes_t, "sents": sents, "polarity": pol}
                rid += 1

    responses.sort(key=lambda r: (r["date"], r["id"]))

    payload = {
        "generated": "2026-10-15",
        "note": "Synthetic data for demonstration. Replace with a real survey export that has the same fields.",
        "responses": responses,
    }
    with open(os.path.join(HERE, "data.js"), "w", encoding="utf-8") as f:
        f.write("// Synthetic survey data. Generated by generate_data.py. Do not use as real customer data.\n")
        f.write("window.NPS_DATA = {\n")
        f.write('  "generated": %s,\n' % json.dumps(payload["generated"]))
        f.write('  "note": %s,\n' % json.dumps(payload["note"]))
        f.write('  "responses": [\n')
        f.write(",\n".join("    " + json.dumps(r, ensure_ascii=False) for r in responses))
        f.write("\n  ]\n};\n")

    os.makedirs(os.path.join(HERE, "tests"), exist_ok=True)
    with open(os.path.join(HERE, "tests", "truth.json"), "w", encoding="utf-8") as f:
        json.dump(truth, f)

    nps = [r for r in responses if r["survey"] == "NPS"]
    csat = [r for r in responses if r["survey"] == "CSAT"]
    prom = sum(r["score"] >= 9 for r in nps)
    det = sum(r["score"] <= 6 for r in nps)
    sat = sum(r["score"] >= 4 for r in csat)
    print("responses:", len(responses), "| NPS:", len(nps), "| CSAT:", len(csat))
    print("overall NPS: %+d" % round((prom - det) / len(nps) * 100), "| CSAT %% satisfied: %d" % round(sat / len(csat) * 100))


if __name__ == "__main__":
    main()
