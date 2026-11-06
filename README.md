# Stock Pulse

A personal, local-first dashboard for US stocks: a **watchlist that tells you when a stock is at a good price**, and a **portfolio tracker** with profit/loss and buy/sell suggestions.

## Quick start

```bash
npm install
cp .env.example .env.local   # add your OPENAI_API_KEY for AI insights (optional)
npm run dev                  # open http://localhost:3000
```

> Requires Node 20+. Node 22+ is recommended (`yahoo-finance2` prints a warning on older versions but works).

Your data is saved to `data/store.json` (git-ignored). Back that file up if you care about it.

## What you get

**Overview**: portfolio value, today's P/L, total P/L, allocation donut, biggest movers, and an *action center*:
- **Buy opportunities**: watchlist stocks in the buy zone, at your target, or within 5% of it
- **Needs your attention**: holdings flagged *Take Profit*, *Consider Trimming*, *Review – Stop Hit* or *Add More*

**Watchlist**: price, 30-day sparkline, distance to your target, 52-week range, RSI, and a **Buy signal score (0–100)**.

**Portfolio**: shares, average cost, value, day P/L, total P/L, weight, and a suggestion with the reason behind it.

**Stock drawer** (click any row): price chart with 50/200-day averages and your cost/target/stop lines, "why this score" breakdown, key stats, an AI insight, and quick actions (set target, *I bought it*, edit, partial sell).

**AI Advisor** (click a *Suggestion* / **✨ Why?** in Portfolio, **✨ Ask AI** in Watchlist, or any row in the Overview action center): a structured buy/sell call with:
- recommendation, confidence and time horizon
- step-by-step reasoning and a bull/bear case
- news sentiment per headline
- buy zone, stop-loss and target levels
- an action plan that uses *your* share count and cost basis
- what would change the call

It uses live web search for fresh news (turn it off with `AI_WEB_SEARCH=false`). Results are cached for 4 hours per stock.

**Pre-market & after-hours prices:** before the open and after the close, every price in Portfolio, Watchlist, the AI Trader and the stock drawer shows the extended-hours quote and % change. The Overview and Portfolio header also show your whole portfolio's pre-market or after-hours profit/loss.

**News & sentiment** (free, no AI): latest headlines, Trading Central short/mid/long-term outlook, analyst rating mix, and recent upgrades/downgrades with price-target changes.

**AI Trader** (paper money): you fund a pretend account and the AI manages it on its own.
- **Research:** it looks at your watchlist and holdings, plus optional screener discoveries. For each stock it reads price action, valuation, analyst moves and news, then decides BUY/SELL/HOLD with written reasoning.
- **Hard limits in code:** a maximum % per position, a cash reserve, a maximum number of positions and a minimum confidence, all set by the risk profile. Every buy gets an automatic stop-loss.
- **When it trades (3 modes):**
  - **⚡ Event-driven (default):** a free scanner checks ~80–100 stocks every minute during market hours. It covers the AI's positions, your holdings, your watchlist and screener ideas. It wakes the AI only when something happens:
    - *AI's positions:* near the stop-loss, a ±3% move since the AI last looked, overbought, broke below the 50-day or 200-day average, a new headline, an analyst downgrade, earnings within a day.
    - *Candidates:* the buy score crosses 75, a pullback to the 50-day average in an uptrend, an oversold profitable company, a 52-week-high breakout on volume, a ≥5% drop, your watchlist target hit, an analyst upgrade.
    - *Market:* the S&P 500 moves ±1.5% → whole-portfolio review.
  - **Limits:**
    - Triggers are batched for 2 minutes into one AI call of at most 12 stocks, prioritised as urgent first, then positions, then the most-triggered candidates.
    - Each stock has a 2-hour cooldown.
    - The default limit is 12 AI runs a day. After that, only urgent triggers get through.
    - A position can't be sold within 1 day of buying it unless its stop-loss is threatened.
    - The first time a stock appears it's recorded, not fired, so there are no bursts.
    - There are safety-net full reviews at 9:45 and 15:30 ET.
    - Sensitivity (Sensitive, Normal or Only big moves), the daily limit and the cooldown can all be changed in Settings.
  - **⏱ Scheduled:** a full review every hour, every 4 hours or once a day during market hours.
  - **✋ Manual:** trades only when you click *Run AI now*.
  - Every trigger appears in **Scanner activity** with what the AI decided (or why it was skipped). *Scan now* runs a scan immediately, even outside market hours.
- **Market hours only:** it trades only while each stock's own market is in its regular session (9:30–16:00 ET for US stocks; holidays and early closes come from Yahoo's market status).
  - Outside those hours the AI can still analyze, but every BUY/SELL becomes a **queued order**.
  - Queued orders fill a few minutes after the next open (from 9:35 ET, after the opening auction spike).
  - A queued buy is cancelled if the stock opens more than 3% above the price the AI decided at.
  - Orders expire after 3 days. You can cancel them in the *Queued orders* panel.
  - Closing a position yourself while the market is closed also queues the sell.
- **Stops and targets:** checked every minute in every mode, and only filled during the stock's regular session.
- **Scored against the S&P 500:** every deposit also "buys" the same dollars of SPY. You see the AI's return against the S&P 500, its win rate, maximum drawdown and a *Confidence check* verdict.

**Morning brief** (top of Overview): generated every weekday after 8:30am New York time while the app is running, or on demand.
- It searches today's market news and reads your positions.
- It gives you 3 prioritised actions, the market backdrop, stocks to watch, risks, an earnings watch and a mindset tip.
- It refreshes the AI's watchlist picks at the same time.

**AI watchlist picks**: the AI researches screener ideas and adds the best ones to your watchlist, tagged **AI** with its reason and a target price.
- **Its own picks:** it may remove them later; click *Make it mine* to keep one permanently.
- **Your stocks:** it never removes them, and never touches stocks you own. It can only flag one with **REMOVE?**, and you choose *Remove it* or *Keep it*.
- **Controls:** turn picks on or off and set the maximum (3, 6 or 10) in the Watchlist header, or use *Refresh AI picks* to run it now.

**Before you buy**: an instant checklist when adding a holding or clicking *I bought it*.
- It checks the buy signal, your position size after the buy, sector concentration, earnings within 7 days, whether you're chasing a spike, RSI, trend and analyst upside, and whether the stock is speculative.
- You get a verdict (Go, Caution or Stop & rethink), a suggested maximum share count and a suggested stop-loss.

**Earnings calendar**: holdings and watchlist reports in the next 3 weeks, with EPS and revenue estimates. You get an alert 3 days before each of your holdings reports.

**Portfolio health** (0–100, A–F): scores concentration (largest position and top 3), sector mix, speculative exposure, stop-loss coverage and deep losers, with specific fixes. Suggestions never say "Add More" for a position that's already over 20% of the portfolio.

**Decision journal** (tab): log the why, your confidence and your emotion for every decision; you're prompted automatically after buys and sells in the app.
- It records what the signals and the AI said at the time, then grades each entry ✓ or ✗ against what the price did next.
- *AI review my decisions* gives a grade, strengths, mistakes, biases (FOMO, loss aversion and so on), rules to adopt, and a comparison with the AI Trader.

**AI & costs** (switch in the top bar, showing e.g. "AI on · $0.12 today"):
- **Pause all AI:** 1 hour, until tomorrow 8am ET, or until you resume. Every OpenAI call goes through one gate, so the Advisor, AI Trader, morning brief, watchlist picks and journal review all stop. Free features keep working.
- **Daily budget:** $0.25, $0.50, $1, $2 or $5 a day. AI auto-pauses for the rest of the day when the estimated spend reaches it, and you get a notification.
- **Usage:** today, last 7 days and last 30 days, a daily spend chart, and a cost breakdown per feature. Estimates come from the token counts OpenAI reports for each call; set your model's prices in the panel.
- **Live web search switch:** for the Advisor and the brief. Turning it off cut an Advisor call from ~$0.08 to ~$0.017 in testing.
- **AI Trader → Pause trader:** stops scanning, AI runs and queued-order fills. Stop-losses and take-profits still protect open positions.

**Notifications** (bell icon + toast popups), fired once when a condition becomes true:
- Watchlist: hit your target price · entered Strong Buy Zone · RSI oversold · ±5% day
- Holdings: stop-loss hit · take-profit hit · overbought · ±5% day · up 10/25/50% · down 10%

**Refresh**: auto-refresh (30s / 1m / 5m / off, paused while the tab is hidden) plus a manual refresh button.

## How the Buy signal score works

The score starts at 50 and each rule adds or subtracts points:

| Factor | Bullish (+) | Bearish (−) |
|---|---|---|
| Your target price | at/below target +25, within 3% +10 | — |
| RSI(14) | < 30 +15, < 40 +7 | > 75 −15, > 65 −6 |
| 52-week range | bottom 20% +10 | top 8% −7 |
| 200-day average | above +5 | below −5 |
| Pullback to 50-day (in uptrend) | +8 | > 12% above 50-day −6 |
| 50 vs 200-day (golden/death cross) | +4 | −4 |
| PEG ratio | < 1 +8 | > 2.5 −5 |
| Forward vs trailing P/E | earnings growth +4 | trailing P/E > 60 −5 |
| Analyst avg target | > 15% upside +8 | below price −8 |
| Analyst rating | buy / strong buy +3 | sell −5 |

**75+** Strong Buy Zone · **60+** Buy Zone · **45+** Neutral · **30+** Wait · below that Overheated.

Tune the rules in [`src/lib/analysis.ts`](src/lib/analysis.ts).

## Project layout

```
src/lib/market.ts      Yahoo Finance: quotes, history, fundamentals, search (cached)
src/lib/analysis.ts    buy score + holding suggestions
src/lib/dashboard.ts   assembles the dashboard + edge-triggered alerts
src/lib/research.ts    news, technical outlook, analyst actions → compact research pack
src/lib/llm.ts         OpenAI Structured Outputs helper (+ optional web search)
src/lib/usage.ts       AI pause switch, daily budget gate, usage & cost tracking
src/lib/advisor.ts     AI Advisor deep analysis (cached 4h per stock)
src/lib/trader.ts      AI Trader: decisions, guardrails, simulated fills, benchmark
src/lib/scanner.ts     event-driven AI Trader: 1-min trigger scan, batching, cooldowns, daily cap
src/lib/time.ts        New York market clock
src/lib/brief.ts       morning brief (+ scheduler)
src/lib/curator.ts     AI watchlist picks (guardrails on add/remove)
src/lib/precheck.ts    before-you-buy checklist
src/lib/journal.ts     decision journal + AI coach review
src/lib/health.ts      portfolio health score
src/instrumentation*.ts  background loop (stops, equity snapshots, scheduled runs)
src/lib/store.ts       JSON-file storage in data/store.json
src/app/api/*          REST endpoints
src/components/*       UI
```

Handy URLs: `/?tab=watchlist`, `/?tab=portfolio`, `/?open=NVDA`.

---

Data comes from Yahoo Finance through the unofficial `yahoo-finance2` library and may be delayed. The scores and AI text are decision aids, **not financial advice**.
