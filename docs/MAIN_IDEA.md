# Portfolio Wrapped: Product Overview

Sep 26, 2026 · @Sean Lange

## What it is

Portfolio Wrapped is a personal newsletter about what you own, and every line of it can be clicked and explored. You enter your holdings: stocks, ETFs, and alternatives like BREIT, BCRED or crypto. The app reads the filings, news, price moves and macro data behind them, then shows the few things that actually mattered as a Spotify Wrapped-style recap. Click any story, number, chart or phrase, or just ask a question, and a new interactive view (a story deck or a full chart dashboard) is generated in seconds, grounded in real data.

One line: **your portfolio's news, explained visually, and explorable down to any detail you're curious about.**

## Who it's for and the problem

The target user is the self-directed investor who owns 5-30 positions and doesn't have time to read 10-Qs. That includes the growing group of individuals holding private-market funds (BREIT, BCRED and similar) alongside public stocks.

Their problem:

- **Scattered.** Filings are on EDGAR, news is on ten sites, prices are in a brokerage app, fund updates are in PDFs. Nothing is organized around *their* holdings.
- **Unranked.** Most of it doesn't matter. They can't tell which of 200 headlines actually affects their money.
- **Dense.** A filing mentions a lock-up expiry or a covenant change, and they don't know what it means or why it matters.
- **Static.** Brokerage dashboards show the same fixed charts. Asking a follow-up question means opening five tabs.

What they get instead: one place, ranked by impact on their portfolio, explained in plain language, visual first, and able to answer the next question on the spot.

## Core experience

The product is a loop: every generated view is clickable, so users can keep drilling as far as their curiosity goes.

&#91;embedded content: core loop · onboarding, recap, then open-ended exploration\]

1. **Add holdings.** Search and add tickers or funds with rough weights, or pick a sample portfolio.
2. **Home recap.** An animated Wrapped-style intro ("This week, your portfolio..."), then the top 3-5 stories ranked by impact on *you*: a holding IPO'd, earnings beat, an 8-K, a big price move, a fund NAV update.
3. **Generated view.** Tapping a story opens a swipeable story deck. Asking to *see* something ("show me Acme's financials") opens a chart dashboard.
4. **Click anything.** Every chart point, number, header or highlighted phrase has "Learn more" and an ask box. That generates the next view, with breadcrumbs to go back.

## Features

| Feature | What the user sees | Example |
| --- | --- | --- |
| Portfolio recap | Animated Wrapped-style intro + ranked top stories with short summaries (expandable) | "Top story #1: Acme went public. You're up $412." |
| Story decks | Swipeable slides generated per story: the answer first, then evidence (charts, filing quotes, timeline) | Acme IPO: pricing, first-day move, lock-up date, what it means for you |
| Chart dashboards | Grid of charts, KPIs and tables generated for "show me" asks | "Show me Acme's financials" → revenue/margin trends, income-statement waterfall, FCF, peer scatter |
| Click-to-explain | Every element is clickable: "Learn more" or ask a question about it | Click the Q3 revenue bar → a deck on what drove it |
| Ask bar | Global natural-language box across the whole portfolio | "Which of my holdings is most exposed to rate cuts?" |
| Plain-language education | Inline term explainers on jargon | Hover "lock-up period" → one-line definition + why it matters |
| Sources everywhere | Chips linking to the actual filing, article or dataset | EDGAR 424B4 link on the IPO price |
| Alternatives support | Private-market funds tracked via NAV and distribution updates, next to stocks | BREIT NAV trend and distribution yield in the same recap |

Stretch features if time allows:

- Portfolio-level visuals: sector exposure, correlation heatmap, contribution to return.
- "Research a new idea": ask about a ticker you don't own and compare it to your holdings. This hits the track's "evaluate what to invest in next" angle.
- Shareable recap card (image export), true to the Wrapped concept.

## Why it fits the Blackstone track

The track asks for accessible, actionable and engaging, and the product maps to almost every example in the prompt.

| Track prompt | How we hit it |
| --- | --- |
| Information spread across sources | Filings, news, prices, macro and fund updates unified around the user's holdings |
| Understand current investments | Ranked recap + per-story decks |
| Research new opportunities | Ask bar + "research a new idea" comparison (stretch) |
| Summarize complex information | Plain-language summaries, term explainers, filing excerpts with context |
| Visualize performance | Generated chart dashboards on demand |
| Ask questions in natural language | Ask bar + click-to-ask on any element |
| Engaging | Wrapped format, animation, infinite drill-down |

The differentiator to say out loud in judging: most AI finance tools answer in a chat bubble of text. Ours answers with **generated, interactive visual interfaces**, and every answer is itself explorable. Including private-market funds like BREIT next to public stocks is a nod judges from Blackstone will notice.

## Data sources

Everything uses free, public data; for the demo, anything slow or rate-limited is pre-ingested for a sample portfolio.

| Data | Source | Demo plan |
| --- | --- | --- |
| Filings (8-K, 10-Q/K, S-1, 424B4, Form 4) | SEC EDGAR APIs | Real, pre-ingested + embedded |
| Financial statements | SEC XBRL `companyfacts` (or Finnhub/FMP) | Real, pre-ingested |
| News | Finnhub company news | Real, cached |
| IPO/earnings calendars | Finnhub | Real, cached |
| Prices | Polygon or yfinance | Real, cached daily |
| Macro (rates, CPI) | FRED | Real, cached |
| Private funds (BREIT, BCRED) | Published NAV/distribution updates | Scraped or hand-entered for the demo |
| Crypto | CoinGecko | Real, cached |
| User portfolios | Our DB (CRUD) | Sample portfolio seeded; users can add their own |

## Demo script (about 3 minutes)

Show the loop three times, each deeper than the last, then hand the ask bar to the judges.

1. **Hook (20s).** "Investors own more than they can keep up with. What if your portfolio sent you a Wrapped every week?"
2. **Recap (30s).** Load the sample portfolio. Animated intro, then top stories: a recent IPO, an earnings surprise, a BREIT NAV update.
3. **Story deck (40s).** Tap the IPO. Swipe through pricing, first-day move, lock-up date and a filing quote.
4. **Drill down (30s).** Click "lock-up expiry" → a new deck explaining what happens when insiders can sell.
5. **Dashboard (40s).** Ask "show me Acme's financials" → full chart dashboard. Click a revenue bar → what drove that quarter.
6. **Judges' turn (20s).** Invite a judge to type any question into the ask bar.

The beat to land: every screen after the home page was generated live, and every screen is clickable.

## Open questions

- [ ] **Name.** "Portfolio Wrapped" is a placeholder. Keep it or pick something else?
- [ ] **Primary user.** Retail stock investors, private-fund investors (BREIT/BCRED LPs), or both equally?
- [ ] **Cadence.** Weekly recap, daily, or "since your last visit"?
- [ ] **Alternatives scope.** Which alts are in: Blackstone funds only, crypto, real estate, others?
- [ ] **Portfolio input.** Manual ticker entry only, or also CSV upload / brokerage-style import?
- [ ] **Demo portfolio.** Which real holdings? The IPO story needs a company that recently IPO'd.
- [ ] **Platform.** Web only, or mobile-first given the Wrapped format?
