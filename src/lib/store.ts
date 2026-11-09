import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { StoreData } from "./types";

const DATA_DIR = process.env.STOCK_PULSE_DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "store.json");

const EMPTY: StoreData = {
  watchlist: [],
  holdings: [],
  notifications: [],
  alertState: {},
  analyses: {},
  journal: [],
  briefs: [],
  settings: {
    aiWatchlist: true,
    maxAiPicks: 6,
    autoBrief: true,
    aiPaused: false,
    aiPausedUntil: null,
    dailyBudgetUsd: 0,
    // estimates only — adjust in "AI & costs" to your model's actual pricing
    priceInputPerM: 1.25,
    priceOutputPerM: 10,
    pricePerWebSearch: 0.01,
    webSearch: true,
    telegramChatId: null,
    signalsEnabled: true,
    copyBudgetUsd: 0,
  },
  usage: {},
};

export function readStore(): StoreData {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const d = { ...structuredClone(EMPTY), ...JSON.parse(raw) };
    d.settings = { ...EMPTY.settings, ...d.settings };
    delete d.aiCache; // legacy field from v1
    return d;
  } catch {
    return structuredClone(EMPTY);
  }
}

export function writeStore(data: StoreData) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
}

/** Read-modify-write helper. Node handles requests on one thread, so sync IO keeps this atomic. */
export function updateStore<T>(fn: (d: StoreData) => T): T {
  const d = readStore();
  const result = fn(d);
  writeStore(d);
  return result;
}

export function normSymbol(s: string) {
  return s.trim().toUpperCase();
}
