export interface WatchItem {
  symbol: string;
  targetPrice?: number | null;
  notes?: string;
  addedAt: string;
  /** who put it on the watchlist */
  addedBy?: "user" | "ai";
  /** why the AI added it */
  aiReason?: string;
  /** AI thinks a user-added stock no longer deserves a spot (user decides) */
  aiRemoveSuggestion?: { reason: string; at: string } | null;
  /** user dismissed a removal suggestion — AI won't flag it again */
  aiKeep?: boolean;
}

export interface Holding {
  symbol: string;
  qty: number;
  avgPrice: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  notes?: string;
  addedAt: string;
}

export type Severity = "info" | "good" | "warn" | "bad";

export interface AppNotification {
  id: string;
  symbol: string;
  kind: string;
  title: string;
  message: string;
  severity: Severity;
  createdAt: string;
  read: boolean;
}

export interface StoreData {
  watchlist: WatchItem[];
  holdings: Holding[];
  notifications: AppNotification[];
  /** alert key -> whether the condition was active at last check (for edge-triggered alerts) */
  alertState: Record<string, boolean>;
  /** deep AI analyses per symbol */
  analyses: Record<string, AiAnalysis>;
  aiTrader?: TraderState;
  journal: JournalEntry[];
  journalReview?: JournalReview;
  /** keyed by US/Eastern date, newest first */
  briefs: MorningBrief[];
  settings: AppSettings;
  /** AI usage per US/Eastern day */
  usage: Record<string, UsageDay>;
}

export interface AppSettings {
  /** let the AI add/remove its own picks on your watchlist */
  aiWatchlist: boolean;
  /** max stocks the AI may have on your watchlist at once */
  maxAiPicks: number;
  /** generate the morning brief automatically on weekdays */
  autoBrief: boolean;
  /** global kill switch: no OpenAI calls at all while true */
  aiPaused: boolean;
  /** auto-resume time (ISO); null = paused until manually resumed */
  aiPausedUntil: string | null;
  /** stop all AI for the rest of the day once today's estimated spend reaches this (USD). 0 = no cap */
  dailyBudgetUsd: number;
  /** pricing used for cost estimates (USD) — set these to your model's prices */
  priceInputPerM: number;
  priceOutputPerM: number;
  pricePerWebSearch: number;
  /** let the Advisor and morning brief search the live web (better news, ~5–10× the cost per call) */
  webSearch: boolean;
  /** Telegram chat that receives AI Trader signals (bot token lives in .env) */
  telegramChatId: string | null;
  /** send a Telegram message for every AI Trader buy/sell */
  signalsEnabled: boolean;
  /** account size used to turn signals into exact share counts; 0 = live value of your real portfolio */
  copyBudgetUsd: number;
}

export type AiFeature = "advisor" | "trader" | "brief" | "curator" | "journal" | "other";

export interface UsageDay {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
  cost: number;
  byFeature: Partial<Record<AiFeature, { calls: number; cost: number }>>;
}

export interface AiStatus {
  enabled: boolean; // API key present
  active: boolean; // enabled and not paused / over budget
  paused: boolean;
  pausedUntil: string | null;
  reason: "no-key" | "paused" | "budget" | null;
  today: UsageDay;
  last7: { calls: number; cost: number };
  last30: { calls: number; cost: number };
  byFeature30: Partial<Record<AiFeature, { calls: number; cost: number }>>;
  history: { date: string; cost: number; calls: number }[];
  settings: Pick<AppSettings, "dailyBudgetUsd" | "priceInputPerM" | "priceOutputPerM" | "pricePerWebSearch" | "webSearch">;
}

// ---------------- decision journal ----------------

export type JournalAction = "BUY" | "ADD" | "SELL" | "TRIM" | "WATCH" | "PASS";
export type Emotion = "calm" | "confident" | "fomo" | "fearful" | "greedy" | "unsure";

export interface JournalEntry {
  id: string;
  createdAt: string;
  symbol: string;
  action: JournalAction;
  price: number;
  qty?: number | null;
  reasoning: string;
  confidence: number; // 1-5
  emotion?: Emotion;
  horizon?: string;
  /** what the app/AI said at the moment you decided */
  snapshot?: { buyScore?: number; verdict?: string; aiRecommendation?: string; aiConfidence?: number; rsi?: number };
}

export interface JournalReview {
  createdAt: string;
  model: string;
  grade: string;
  summary: string;
  strengths: string[];
  mistakes: string[];
  biases: { name: string; evidence: string }[];
  lessons: string[];
  vsAiTrader: string;
}

// ---------------- morning brief ----------------

export interface MorningBrief {
  date: string; // YYYY-MM-DD (US/Eastern)
  createdAt: string;
  model: string;
  usedWebSearch: boolean;
  sources: { title: string; url: string }[];
  headline: string;
  marketBackdrop: string;
  portfolioPulse: string;
  topActions: { priority: number; symbol: string | null; action: string; why: string }[];
  watchToday: { symbol: string; why: string }[];
  earningsWatch: { symbol: string; date: string; note: string }[];
  risks: string[];
  mindsetTip: string;
  watchlistChanges: string[];
}

// ---------------- health & earnings ----------------

export interface HealthReport {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  label: string;
  issues: { severity: "bad" | "warn"; text: string }[];
  strengths: string[];
  sectors: { sector: string; weight: number }[];
  topHoldingPct: number;
  top3Pct: number;
  speculativePct: number;
  stopsCoveragePct: number;
}

export interface EarningsEvent {
  symbol: string;
  name: string;
  date: string;
  daysAway: number;
  owned: boolean;
  positionValue?: number;
  epsEstimate?: number;
  revenueEstimate?: number;
}

export interface PreBuyCheck {
  symbol: string;
  price: number;
  qty: number;
  verdict: "Go" | "Caution" | "Stop & rethink";
  checks: { label: string; status: "pass" | "warn" | "fail" | "info"; detail: string }[];
  suggestedMaxQty: number;
  suggestedStop: number;
  positionPctAfter: number;
}

// ---------------- research / news ----------------

export interface NewsItem {
  title: string;
  publisher: string;
  link: string;
  publishedAt: string;
}

export interface Outlook {
  direction: string; // Bullish | Bearish | Neutral
  score?: number;
  description?: string;
}

export interface AnalystAction {
  date: string;
  firm: string;
  action: string; // up | down | main | reit | init
  toGrade: string;
  fromGrade?: string;
  priceTarget?: number;
  priorPriceTarget?: number;
}

export interface Sentiment {
  news: NewsItem[];
  outlook?: { short?: Outlook; mid?: Outlook; long?: Outlook; provider?: string };
  analystActions: AnalystAction[];
  ratings?: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number };
  developments: { headline: string; date: string }[];
  researchRating?: { provider: string; rating: string; targetPrice?: number };
}

// ---------------- deep AI analysis ----------------

export type AiRecommendation = "Strong Buy" | "Buy" | "Accumulate on Dips" | "Hold" | "Trim" | "Sell" | "Avoid";

export interface AiAnalysis {
  symbol: string;
  createdAt: string;
  model: string;
  priceAtAnalysis: number;
  usedWebSearch: boolean;
  sources: { title: string; url: string }[];
  recommendation: AiRecommendation;
  confidence: number;
  horizon: string;
  headline: string;
  reasoning: string;
  bullCase: string[];
  bearCase: string[];
  newsSentiment: {
    overall: "Positive" | "Neutral" | "Negative" | "Mixed";
    summary: string;
    items: { headline: string; sentiment: "Positive" | "Neutral" | "Negative"; impact: string }[];
  };
  technicalView: string;
  valuationView: string;
  levels: { buyZoneLow: number | null; buyZoneHigh: number | null; stopLoss: number | null; target: number | null };
  actionPlan: string[];
  whatWouldChangeMyMind: string[];
  positionAdvice: string | null;
}

// ---------------- AI Trader (paper trading) ----------------

export type RiskProfile = "conservative" | "balanced" | "aggressive";

export type TraderMode = "event" | "scheduled" | "manual";
export type Sensitivity = "sensitive" | "normal" | "big";

export interface TraderConfig {
  risk: RiskProfile;
  universe: "watchlist" | "discover";
  /** event = scanner wakes the AI on opportunities; scheduled = fixed interval; manual = only "Run AI now" */
  mode?: TraderMode;
  sensitivity?: Sensitivity;
  maxRunsPerDay?: number;
  cooldownMinutes?: number;
  /** legacy/scheduled-mode fields */
  autoRun: boolean;
  intervalMinutes: number;
  webSearch: boolean;
  minConfidence: number;
  /** pause just the AI Trader: no scanning, AI runs or queued fills (stop-losses still protect) */
  paused?: boolean;
}

export type RunTrigger = "manual" | "scheduled" | "event" | "open-review" | "close-review" | "market-move";

export interface ScanEvent {
  id: string;
  at: string;
  symbol: string; // "SPY" for market-wide events
  kind: string;
  label: string;
  detail: string;
  urgent: boolean;
  group: "position" | "candidate" | "market";
  status: "queued" | "sent" | "cooldown" | "capped" | "dropped";
  runId?: string;
  outcome?: string;
}

export interface ScannerState {
  /** price when the AI last looked at each symbol (baseline for "moved X% since") */
  lookPrice: Record<string, number>;
  lastAiLook: Record<string, string>;
  /** edge-trigger flags: `${symbol}:${kind}` -> condition active at last scan */
  flags: Record<string, boolean>;
  seenNews: Record<string, string[]>;
  seenAnalyst: Record<string, string>;
  runsToday: { date: string; count: number };
  reviews: { date: string; open: boolean; close: boolean };
  pending: ScanEvent[];
  log: ScanEvent[];
  lastScanAt?: string;
  universeSize?: number;
}

export interface TraderPosition {
  symbol: string;
  qty: number;
  avgPrice: number;
  openedAt: string;
  stopLoss: number | null;
  takeProfit: number | null;
  thesis: string;
}

export interface Trade {
  id: string;
  at: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  value: number;
  trigger: "ai" | "stop" | "target" | "manual";
  confidence?: number;
  reason: string;
  realizedPl?: number;
  realizedPlPct?: number;
}

export interface TraderDecision {
  symbol: string;
  action: "BUY" | "SELL" | "HOLD";
  percentOfEquity: number;
  sellFraction: number;
  confidence: number;
  reasoning: string;
  stopLoss: number | null;
  takeProfit: number | null;
  executed?: string; // what actually happened after guardrails
}

export interface TraderRun {
  id: string;
  at: string;
  model: string;
  marketView: string;
  candidates: string[];
  decisions: TraderDecision[];
  equityAfter?: number;
  error?: string;
  manual: boolean;
  trigger?: RunTrigger;
  /** human-readable reasons the AI was woken up */
  triggeredBy?: string[];
}

export interface TraderState {
  config: TraderConfig;
  startedAt: string;
  deposited: number;
  cash: number;
  /** virtual S&P 500 (SPY) units bought with every deposit, for an honest benchmark */
  spyUnits: number;
  positions: Record<string, TraderPosition>;
  trades: Trade[];
  runs: TraderRun[];
  equityHistory: { at: string; equity: number; benchmark: number }[];
  lastRunAt?: string;
  scanner?: ScannerState;
  /** orders decided while the stock's market was closed; filled at the next regular session */
  orders?: PendingOrder[];
}

export interface PendingOrder {
  id: string;
  createdAt: string;
  symbol: string;
  side: "BUY" | "SELL";
  source: "ai" | "manual";
  /** price when the decision was made — used for gap protection at the open */
  decisionPrice: number;
  percentOfEquity: number;
  sellFraction: number;
  confidence: number;
  reasoning: string;
  stopLoss: number | null;
  takeProfit: number | null;
  allowQuickSell: boolean;
  runId?: string;
  status: "pending" | "filled" | "cancelled" | "expired";
  resolvedAt?: string;
  note?: string;
}

export interface TraderView {
  state: TraderState;
  running: boolean;
  runningSince?: string;
  positions: (TraderPosition & { price: number; changePct: number; value: number; pl: number; plPct: number; weight: number; name: string; ext?: QuoteLite["ext"] })[];
  equity: number;
  invested: number;
  totalReturn: number;
  totalReturnPct: number;
  benchmarkValue: number;
  benchmarkReturnPct: number;
  realizedPl: number;
  winRate: number | null;
  closedTrades: number;
  maxDrawdownPct: number;
  marketState?: string;
  nextRunAt?: string;
  orders: PendingOrder[];
  scanner: {
    mode: TraderMode;
    sensitivity: Sensitivity;
    maxRunsPerDay: number;
    cooldownMinutes: number;
    runsToday: number;
    lastScanAt?: string;
    universeSize?: number;
    pending: number;
    log: ScanEvent[];
  };
}

export type Tone = "good" | "bad" | "neutral";

export interface Signal {
  label: string;
  detail: string;
  tone: Tone;
}

export interface Fundamentals {
  sector?: string;
  industry?: string;
  pegRatio?: number;
  analystTarget?: number;
  analystLow?: number;
  analystHigh?: number;
  recommendation?: string;
  analystCount?: number;
  revenueGrowth?: number;
  profitMargin?: number;
  summary?: string;
}

export interface Technicals {
  rsi14?: number;
  sma50?: number;
  sma200?: number;
  high52?: number;
  low52?: number;
  rangePos?: number; // 0..1 position within 52w range
  spark: number[]; // last ~30 closes
}

export interface QuoteLite {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  prevClose?: number;
  marketState?: string;
  marketCap?: number;
  trailingPE?: number;
  forwardPE?: number;
  dividendYield?: number; // percent, e.g. 0.45 = 0.45%
  volume?: number;
  avgVolume?: number;
  earningsDate?: string;
  /** extended-hours quote (pre-market before the open, after-hours after the close) */
  ext?: { session: "pre" | "post"; price: number; change: number; changePct: number; at?: string };
}

export type BuyVerdict = "Strong Buy Zone" | "Buy Zone" | "Neutral" | "Wait" | "Overheated";
export type HoldAction = "Hold" | "Add More" | "Consider Trimming" | "Take Profit" | "Review – Stop Hit";

export interface Analysis {
  score: number; // 0-100 buy attractiveness
  verdict: BuyVerdict;
  signals: Signal[];
}

export interface EnrichedWatch extends WatchItem {
  quote?: QuoteLite;
  tech?: Technicals;
  fund?: Fundamentals;
  analysis?: Analysis;
  distanceToTargetPct?: number | null;
  error?: string;
}

export interface EnrichedHolding extends Holding {
  quote?: QuoteLite;
  tech?: Technicals;
  fund?: Fundamentals;
  analysis?: Analysis;
  action?: HoldAction;
  actionReason?: string;
  cost: number;
  value: number;
  pl: number;
  plPct: number;
  dayPl: number;
  weight: number; // % of portfolio value
  error?: string;
}

export interface PortfolioSummary {
  totalValue: number;
  totalCost: number;
  totalPl: number;
  totalPlPct: number;
  dayPl: number;
  dayPlPct: number;
  winners: number;
  losers: number;
  /** pre-market / after-hours move of the whole portfolio vs the last regular close */
  ext?: { session: "pre" | "post"; pl: number; plPct: number; value: number };
}

export interface DashboardData {
  watchlist: EnrichedWatch[];
  holdings: EnrichedHolding[];
  summary: PortfolioSummary;
  unread: number;
  updatedAt: string;
  marketState?: string;
  health: HealthReport | null;
  earnings: EarningsEvent[];
}
