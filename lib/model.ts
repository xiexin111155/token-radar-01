// Token launch radar: the model.
//
// Everything on the board is derived from the sealed snapshot's own figures at run time. Nothing
// is hardcoded per protocol: no list of names, no hand-set values. The program reads 758 protocol
// records, works out which ones still record no token and could plausibly hold a launch of their
// own, and prices each one's launch from what the snapshot's already-tokenised protocols trade at.
//
// Implied value, per protocol:
//
//   implied = TVL x category multiple x growth factor x tokenless-age factor x breadth factor
//
// - Category multiple: the median market-cap / TVL ratio of the snapshot's tokenised protocols in
//   the same DefiLlama category, shrunk toward the global median by sample size and capped, so a
//   category with two members cannot produce a wild price. It answers "what does the market pay
//   for a dollar of TVL in this kind of protocol, today, in this snapshot".
// - Growth factor: 1 + the seven-day TVL change clamped to [-25%, +40%], as a decimal. A protocol
//   adding TVL is worth more at launch than one bleeding it; an unreported change is neutral.
// - Tokenless-age factor: 1 + 0.35 x (1 - e^(-age/540d)). Years of operation with no token are
//   evidence of a real product and a real user base to allocate to; the bonus saturates so age
//   alone never dominates. An unreported listing date is neutral.
// - Breadth factor: 1 + 2% per chain beyond the first, up to ten. A launch allocates across every
//   chain the protocol already serves.
//
// Protocols that record a token are never ranked: they are the evidence base, and the dashboard
// shows them apart, as the comparables the multiples came from. Protocols that record no token
// but are a wrapped, staked or bridged product, a versioned copy, or an exchange's own balance
// sheet are set aside too: they will never hold a launch of their own. The watchlist's 40 are all
// ranked; the board ranks every other genuine candidate the snapshot holds as well.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export class SnapshotError extends Error {}

const DAY_MS = 86_400_000;

/** Categories whose products are a claim on another protocol's asset, never a launch of their own. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** True when DefiLlama's record carries no token for the protocol: no gecko id, no symbol. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** True when a protocol that records no token could still hold a launch of its own one day. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

/** Whole days between the day DefiLlama began tracking the protocol and the snapshot's day. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / DAY_MS));
}

export interface CategoryMultiple {
  category: string;
  n: number;
  median: number;
  used: number;
}

export interface MultipleTable {
  globalMedian: number;
  globalN: number;
  byCategory: Map<string, CategoryMultiple>;
  fallback: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The multiples the model prices with, measured from the snapshot itself: for every tokenised
 * protocol with a recorded market cap, its market cap over its TVL, grouped by category. Each
 * category median is shrunk toward the global median with a prior of four protocols, and the
 * result is capped to the band the snapshot's own distribution supports.
 */
export function computeMultiples(protocols: SnapshotProtocol[]): MultipleTable {
  const ratios: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    ratios.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = perCategory.get(key) ?? [];
    list.push(ratio);
    perCategory.set(key, list);
  }
  const globalMedian = ratios.length > 0 ? median(ratios) : 0.2;
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, list] of perCategory) {
    const med = median(list);
    const shrunk = (list.length * med + 4 * globalMedian) / (list.length + 4);
    byCategory.set(category, { category, n: list.length, median: med, used: clampMultiple(shrunk) });
  }
  return { globalMedian, globalN: ratios.length, byCategory, fallback: clampMultiple(globalMedian) };
}

function clampMultiple(m: number): number {
  return Math.min(2, Math.max(0.02, m));
}

/** The multiple a protocol is priced with: its category's, or the global fallback for thin ones. */
export function multipleFor(p: SnapshotProtocol, table: MultipleTable): CategoryMultiple {
  const found = table.byCategory.get(p.category ?? 'Uncategorised');
  if (found !== undefined && found.n >= 3) return found;
  return { category: p.category ?? 'Uncategorised', n: found?.n ?? 0, median: found?.median ?? table.globalMedian, used: table.fallback };
}

export interface ValueBreakdown {
  implied: number;
  multiple: number;
  growthFactor: number;
  ageFactor: number;
  breadthFactor: number;
  age: number | null;
}

/** Price one protocol's launch from the snapshot's figures, with every factor kept for display. */
export function impliedValue(p: SnapshotProtocol, asOf: string, table: MultipleTable): ValueBreakdown {
  const multiple = multipleFor(p, table).used;
  const growth = p.change_7d === null ? 0 : Math.min(40, Math.max(-25, p.change_7d));
  const growthFactor = 1 + growth / 100;
  const age = ageDays(asOf, p.listed_at);
  const ageFactor = age === null ? 1 : 1 + 0.35 * (1 - Math.exp(-age / 540));
  const breadthFactor = 1 + 0.02 * Math.min(Math.max(p.chains.length - 1, 0), 10);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthFactor * ageFactor * breadthFactor));
  return { implied, multiple, growthFactor, ageFactor, breadthFactor, age };
}

// ---------------------------------------------------------------------------
// Farm plans. Every plan is written for the protocol it names: its main chain, a capital budget
// scaled to its TVL depth, a window scaled to how long it has already run, and the actions its
// category actually offers a user. Each step states what it costs and how long it takes.
// ---------------------------------------------------------------------------

type Playbook = 'dex' | 'lending' | 'cdp' | 'yield' | 'derivatives' | 'rwa' | 'chain' | 'bridge' | 'generic';

function playbookOf(category: string | null): Playbook {
  switch (category) {
    case 'Dexs': return 'dex';
    case 'Lending': return 'lending';
    case 'CDP': return 'cdp';
    case 'Yield': case 'Yield Aggregator': case 'Basis Trading': case 'Risk Curators':
    case 'Onchain Capital Allocator': case 'Staking Pool': case 'Farm': return 'yield';
    case 'Derivatives': return 'derivatives';
    case 'RWA': case 'RWA Lending': return 'rwa';
    case 'Chain': return 'chain';
    case 'Cross Chain Bridge': return 'bridge';
    default: return 'generic';
  }
}

/** Working capital for one wallet, scaled to the protocol's depth so fees and slippage stay sane. */
export function capitalFor(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 5000;
  if (tvlUsd >= 250_000_000) return 2500;
  if (tvlUsd >= 50_000_000) return 1000;
  if (tvlUsd >= 10_000_000) return 500;
  return 250;
}

/** Weeks to spread the farm over: older protocols have longer allocation memories, so farm longer. */
export function weeksFor(age: number | null): number {
  if (age === null) return 6;
  if (age >= 730) return 10;
  if (age >= 365) return 8;
  return 6;
}

/** What one transaction costs on a chain, in the plain terms a farmer budgets with. */
export function feeNote(chain: string): string {
  if (chain === 'Ethereum') return 'mainnet gas of roughly $8-25 per transaction';
  if (chain === 'Solana') return 'fees of a few cents per transaction';
  if (chain === 'Bitcoin') return 'network fees of roughly $1-5 per transaction';
  if (/Arbitrum|Base|Optimism|OP Mainnet|zkSync|Linea|Scroll|Mantle|Blast|Mode|Taiko|Metis|Polygon|Avalanche|BNB|BSC|Gnosis|Fantom|Sonic|Berachain|Monad|Hyperliquid/i.test(chain)) {
    return 'fees under $1 per transaction';
  }
  return 'fees of a dollar or less per transaction';
}

const CORE_ACTION: Record<Playbook, (name: string, chain: string, capital: number) => string> = {
  dex: (name, chain, capital) =>
    `Trade on ${name} itself: swap between the liquid pairs on ${chain} two or three times a week, sizing most swaps between $50 and $${Math.max(50, Math.round(capital / 10))} so fees stay near 1% of volume. Real, repeated flow is what DEX allocations have historically counted.`,
  lending: (name, chain, capital) =>
    `Supply about $${capital} of a major asset (ETH or a large-cap stablecoin) into ${name} on ${chain} and leave it supplied; a balance that sits for weeks reads as a user, a balance that flashes in and out reads as a mercenary.`,
  cdp: (name, chain, capital) =>
    `Open a collateral position on ${name} on ${chain}: deposit about $${capital} of ETH or a liquid staking token, mint its stablecoin against it at a conservative ratio (keep the position above 200% collateralised), and hold it open.`,
  yield: (name, chain, capital) =>
    `Deposit about $${capital} into ${name}'s main vault or curated market on ${chain} and keep it there; these allocators weight time-in-vault and balance history, so an early, steady deposit is the position that matters.`,
  derivatives: (name, chain, capital) =>
    `Trade perps on ${name} on ${chain} with small size: open and close two or three positions a week out of a $${capital} margin balance, keeping each position under a fifth of the balance so one bad candle cannot end the farm.`,
  rwa: (name, chain, capital) =>
    `Take a position in ${name}'s main real-world-asset product on ${chain} with about $${capital}; RWA platforms allocate to holders of record, so the deposit needs to be in place and stay in place rather than rotate.`,
  chain: (name, chain, capital) =>
    `Be an active user of the ${name} chain itself: bridge in about $${capital}, then use its leading DEX, lending market and one or two native apps each week, because a chain's own token, if one comes, is allocated to the chain's users.`,
  bridge: (name, chain, capital) =>
    `Route real transfers through ${name}: bridge $200-$${Math.max(200, Math.round(capital / 5))} between ${chain} and the other chains it serves, a few times a month in both directions, the way someone moving their own money would.`,
  generic: (name, chain, capital) =>
    `Use ${name}'s core product on ${chain} the way a normal user would, with about $${capital} committed: whatever its main action is (deposit, trade, stake or subscribe), do that, on the record, from this wallet.`,
};

const SECOND_ACTION: Record<Playbook, (name: string, chain: string, chains: string[]) => string> = {
  dex: (name, chain, chains) =>
    `Add a small liquidity position (about a quarter of the budget) to a top-three pool on ${name} and leave it in range; liquidity providers are a separate allocation class from swappers on most DEX launches.` + (chains.length > 1 ? ` Repeat the swaps on ${chains[1]} too: multi-chain users are usually weighted above single-chain ones.` : ''),
  lending: (name, chain) =>
    `Borrow a small amount against the supply (under 30% of its value), hold the borrow for at least two weeks, then repay; a completed borrow-and-repay cycle marks the wallet as a borrower, not only a supplier, on ${name}.`,
  cdp: (name, chain) =>
    `Use the minted stablecoin inside the ecosystem: hold it, or supply it to a lending market on ${chain}, rather than selling it at once. Wallets that keep the stablecoin in circulation are the ones a CDP launch needs.`,
  yield: (name, chain, chains) =>
    chains.length > 1
      ? `Split a second, smaller deposit into ${name} on ${chains[1]}; allocators that run on several chains tend to count a wallet once per chain, and the second deposit is cheap insurance.`
      : `Claim and re-deposit any yield or points the vault issues, on schedule; compounding on the record shows a holder, and holders are who a vault token has to reward.`,
  derivatives: (name, chain) =>
    `Keep a resting limit order on ${name}'s book part of each week, not only market orders; maker activity is scarcer than taker activity and is usually the side of the book a launch rewards.`,
  rwa: (name, chain) =>
    `Complete every onboarding and attestation step ${name} offers on ${chain}, even the optional ones; RWA allocations can only go to wallets the platform is allowed to pay, and most users never finish the paperwork.`,
  chain: (name, chain) =>
    `Hold a small balance of the chain's gas token and at least one native asset in the wallet at all times; snapshots for chain launches are often balance-based, and an empty wallet between sessions scores as inactive.`,
  bridge: (name, chain) =>
    `Vary the routes: use ${name} from at least two different source chains over the window, and let some bridged funds stay on the far side for a week or more instead of bridging straight back.`,
  generic: (name, chain) =>
    `Use ${name}'s second feature as well as its first (most protocols have one: a different market, vault or mode on ${chain}); allocation formulas routinely count distinct actions, not only volume.`,
};

/** The farm plan for one protocol: five concrete steps, each with its cost and its time. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const book = playbookOf(p.category);
  const chain = p.chains[0] ?? 'Ethereum';
  const capital = capitalFor(p.tvl_usd);
  const weeks = weeksFor(age);
  const fees = feeNote(chain);
  const steps = [
    `Set up one dedicated wallet for ${p.name} and fund it on ${chain} with about $${capital} of working capital plus fee headroom (${fees}). A fresh wallet per protocol keeps every farm separable. Time: about 30 minutes, once.`,
    CORE_ACTION[book](p.name, chain, capital),
    SECOND_ACTION[book](p.name, chain, p.chains),
    `Spread the activity over ${weeks} weeks: two or three sessions a week, never the whole plan in one day. Bursts are what sybil filters are built to catch, and steady use costs the same in the end: roughly $${Math.max(5, Math.round(capital / 50))} a week in fees and slippage at this size.`,
    `Log every session (date, chain, actions, volume) in a spreadsheet as you go. If ${p.name} announces a token, points programme or eligibility checker, verify this wallet in the first week and claim inside the window: unclaimed allocations are the most common way a finished farm pays nothing.`,
  ];
  return steps.map((s) => s.trim());
}

// ---------------------------------------------------------------------------
// The board and the dashboard's data.
// ---------------------------------------------------------------------------

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  tvl_usd: number;
  category: string | null;
  watchlist: boolean;
}

export interface RadarRow extends BoardRow {
  chains: string[];
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  multiple_used: number;
  category_median: number | null;
  category_n: number;
  growth_factor: number;
  age_factor: number;
  breadth_factor: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  stats: { protocols: number; records_no_token: number; ranked: number; watchlist: number; tokenised: number; total_implied_usd: number };
  multiples: { global_median: number; global_n: number; categories: { category: string; n: number; median: number; used: number }[] };
  rows: RadarRow[];
  live: LiveRow[];
}

/** Build the ranked board and the dashboard's data from one snapshot, deterministically. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const table = computeMultiples(snapshot.protocols);
  const onWatchlist = new Set(snapshot.watchlist);
  const candidates = snapshot.protocols.filter(isRankable);
  const scored = candidates.map((p) => {
    const value = impliedValue(p, snapshot.as_of, table);
    const mult = multipleFor(p, table);
    const row: RadarRow = {
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: value.implied,
      farm_steps: farmSteps(p, value.age),
      tvl_usd: p.tvl_usd,
      category: p.category,
      watchlist: onWatchlist.has(p.slug),
      chains: p.chains,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: value.age,
      multiple_used: value.multiple,
      category_median: mult.n > 0 ? mult.median : null,
      category_n: mult.n,
      growth_factor: value.growthFactor,
      age_factor: value.ageFactor,
      breadth_factor: value.breadthFactor,
    };
    return row;
  });
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  // Ranks are 1..N and implied value must never rise as rank ascends: make the descent strict.
  for (let i = 0; i < scored.length; i++) {
    scored[i]!.rank = i + 1;
    if (i > 0 && scored[i]!.implied_value_usd >= scored[i - 1]!.implied_value_usd) {
      scored[i]!.implied_value_usd = scored[i - 1]!.implied_value_usd - 1;
    }
  }
  const board: BoardRow[] = scored.map((r) => ({
    slug: r.slug, name: r.name, rank: r.rank, implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps, tvl_usd: r.tvl_usd, category: r.category, watchlist: r.watchlist,
  }));
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, ratio: p.mcap_usd! / p.tvl_usd }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd)
    .slice(0, 24);
  const categories = [...table.byCategory.values()]
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1))
    .map((c) => ({ category: c.category, n: c.n, median: c.median, used: c.used }));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    stats: {
      protocols: snapshot.protocols.length,
      records_no_token: snapshot.protocols.filter(recordsNoToken).length,
      ranked: board.length,
      watchlist: snapshot.watchlist.length,
      tokenised: live.length > 0 ? snapshot.protocols.filter((p) => !recordsNoToken(p)).length : 0,
      total_implied_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
    },
    multiples: { global_median: table.globalMedian, global_n: table.globalN, categories },
    rows: scored,
    live,
  };
  return { board, radar };
}

/** The dashboard's data as the script the page loads: window.RADAR, nothing else. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** Parse and lightly validate the sealed snapshot; throws SnapshotError on a malformed file. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot is not valid JSON');
  }
  const snap = raw as Snapshot;
  if (typeof snap !== 'object' || snap === null || !Array.isArray(snap.protocols) || !Array.isArray(snap.watchlist)) {
    throw new SnapshotError('snapshot lacks its protocols or watchlist arrays');
  }
  if (typeof snap.as_of !== 'string' || typeof snap.floor_usd !== 'number') {
    throw new SnapshotError('snapshot lacks as_of or floor_usd');
  }
  for (const p of snap.protocols) {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Array.isArray(p.chains)) {
      throw new SnapshotError(`protocol record is malformed: ${JSON.stringify(p).slice(0, 80)}`);
    }
  }
  return snap;
}

/** The gate's board rules, checked before anything is written: a string names the first breach. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  let allSame = true;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (!known.has(row.slug)) return `row ${i + 1}: slug ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${row.slug}: rank is ${row.rank}, expected ${i + 1}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000) {
      return `row ${row.slug}: implied value ${row.implied_value_usd} is not a positive whole number within the cap`;
    }
    if (row.implied_value_usd > previous) return `row ${row.slug}: implied value rises as rank ascends`;
    if (row.implied_value_usd !== board[0]!.implied_value_usd) allSame = false;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug}: ${row.farm_steps.length} farm steps, outside 3..12`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${row.slug}: a farm step is ${len} characters, outside 20..600`;
    }
  }
  if (allSame) return 'every implied value is the same: the board ranks nothing';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}
