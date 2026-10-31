import type {
  UsageCategoryCost,
  UsageCostSource,
  UsageModelPriceOverride,
  UsageTokenTotals,
} from "@t3tools/contracts";

import type { UsageRecord, UsageSpeed } from "@t3tools/provider-core/server/usage";

export interface TokenPrices {
  readonly inputCostPerToken: number;
  readonly outputCostPerToken: number;
  readonly cacheReadCostPerToken: number;
  readonly cacheCreationCostPerToken: number;
}

/**
 * Prices for requests whose prompt is over `aboveTokens`. The prompt counts uncached input,
 * cache reads and cache writes together.
 */
export interface PromptTier {
  readonly aboveTokens: number;
  readonly prices: TokenPrices;
}

export interface TokenRates extends TokenPrices {
  /** Sorted by `aboveTokens`. A prompt over several tiers pays the highest one it exceeds. */
  readonly promptTiers: readonly PromptTier[];
}

/** Omits LiteLLM's above_272k_tokens, flex and batches variants, which transcripts do not record. */
export interface ModelRate extends TokenRates {
  readonly fast: TokenRates | null;
  readonly ultrafast: TokenRates | null;
}

export type RateTable = ReadonlyMap<string, ModelRate>;

export function createOverrideRateTable(
  overrides: Readonly<Record<string, UsageModelPriceOverride>>,
): RateTable {
  return new Map(
    Object.entries(overrides).map(([model, prices]) => [
      model.trim(),
      {
        inputCostPerToken: prices.inputCostPerMillionTokens / 1_000_000,
        outputCostPerToken: prices.outputCostPerMillionTokens / 1_000_000,
        cacheReadCostPerToken:
          (prices.cacheReadCostPerMillionTokens ?? prices.inputCostPerMillionTokens) / 1_000_000,
        cacheCreationCostPerToken:
          (prices.cacheWriteCostPerMillionTokens ?? prices.inputCostPerMillionTokens) / 1_000_000,
        fast: null,
        ultrafast: null,
        promptTiers: [],
      },
    ]),
  );
}

type LiteLlmEntry = Readonly<Record<string, unknown>>;

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Missing cache rates fall back to input pricing; Anthropic normally discounts reads and charges extra for writes.
function readTokenPrices(
  entry: LiteLlmEntry,
  suffix: string,
  standard?: TokenPrices,
): TokenPrices | null {
  const input = finiteNumber(entry[`input_cost_per_token${suffix}`]);
  const output = finiteNumber(entry[`output_cost_per_token${suffix}`]);
  if (input === null || output === null) return null;
  const cacheRate = (name: string, field: "cacheReadCostPerToken" | "cacheCreationCostPerToken") =>
    finiteNumber(entry[`${name}${suffix}`]) ??
    (standard !== undefined && standard.inputCostPerToken > 0
      ? (standard[field] / standard.inputCostPerToken) * input
      : input);
  return {
    inputCostPerToken: input,
    outputCostPerToken: output,
    cacheReadCostPerToken: cacheRate("cache_read_input_token_cost", "cacheReadCostPerToken"),
    cacheCreationCostPerToken: cacheRate(
      "cache_creation_input_token_cost",
      "cacheCreationCostPerToken",
    ),
  };
}

// LiteLLM spells prompt tiers as input_cost_per_token[<speed suffix>]_above_<N>k_tokens.
const PROMPT_TIER_KEY = /^input_cost_per_token(.*)_above_(\d+)k_tokens$/;
// The 272k tier stays omitted, as described on ModelRate.
const OMITTED_PROMPT_TIER_KILOTOKENS = 272;

function readPromptTiers(
  entry: LiteLlmEntry,
  speedSuffix: string,
  base: TokenPrices,
): PromptTier[] {
  const tiers: PromptTier[] = [];
  for (const key of Object.keys(entry)) {
    const match = PROMPT_TIER_KEY.exec(key);
    if (match === null || match[1] !== speedSuffix) continue;
    const kilotokens = Number(match[2]);
    if (kilotokens === OMITTED_PROMPT_TIER_KILOTOKENS) continue;
    const prices = readTokenPrices(entry, `${speedSuffix}_above_${kilotokens}k_tokens`, base);
    if (prices !== null) tiers.push({ aboveTokens: kilotokens * 1_000, prices });
  }
  return tiers.sort((a, b) => a.aboveTokens - b.aboveTokens);
}

function readRates(
  entry: LiteLlmEntry,
  speedSuffix: string,
  standard?: TokenPrices,
): TokenRates | null {
  const prices = readTokenPrices(entry, speedSuffix, standard);
  if (prices === null) return null;
  return { ...prices, promptTiers: readPromptTiers(entry, speedSuffix, prices) };
}

function scalePrices(prices: TokenPrices, multiple: number): TokenPrices {
  return {
    inputCostPerToken: prices.inputCostPerToken * multiple,
    outputCostPerToken: prices.outputCostPerToken * multiple,
    cacheReadCostPerToken: prices.cacheReadCostPerToken * multiple,
    cacheCreationCostPerToken: prices.cacheCreationCostPerToken * multiple,
  };
}

function scaleTokenRates(rates: TokenRates, multiple: number): TokenRates {
  return {
    ...scalePrices(rates, multiple),
    promptTiers: rates.promptTiers.map((tier) => ({
      aboveTokens: tier.aboveTokens,
      prices: scalePrices(tier.prices, multiple),
    })),
  };
}

function fastMultiplier(entry: LiteLlmEntry): number | null {
  const specific = entry["provider_specific_entry"];
  if (typeof specific !== "object" || specific === null) return null;
  const fast = finiteNumber((specific as Record<string, unknown>)["fast"]);
  return fast !== null && fast > 0 ? fast : null;
}

/** Drops models missing input or output rates to avoid understating cost. */
export function parseRateTable(document: unknown): RateTable {
  const table = new Map<string, ModelRate>();
  if (typeof document !== "object" || document === null) return table;

  for (const [name, raw] of Object.entries(document as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as LiteLlmEntry;
    const standard = readRates(entry, "");
    if (standard === null) continue;

    const key = normalizeRateKey(name);
    if (key.length === 0) continue;
    const multiple = fastMultiplier(entry);
    table.set(key, {
      ...standard,
      fast:
        multiple === null
          ? readRates(entry, "_priority", standard)
          : scaleTokenRates(standard, multiple),
      ultrafast: readRates(entry, "_ultrafast", standard),
    });
  }

  const aliasCandidates = new Map<string, ModelRate | null>();
  for (const [key, rate] of table) {
    const alias = bareModelName(key);
    if (alias.length === 0 || alias === key || table.has(alias)) continue;
    const held = aliasCandidates.get(alias);
    if (held === undefined) {
      aliasCandidates.set(alias, rate);
    } else if (held !== null) {
      aliasCandidates.set(alias, mergeAliasRate(held, rate));
    }
  }
  for (const [alias, rate] of aliasCandidates) {
    if (rate !== null) table.set(alias, rate);
  }

  return table;
}

function samePrices(a: TokenPrices, b: TokenPrices): boolean {
  return (
    a.inputCostPerToken === b.inputCostPerToken &&
    a.outputCostPerToken === b.outputCostPerToken &&
    a.cacheReadCostPerToken === b.cacheReadCostPerToken &&
    a.cacheCreationCostPerToken === b.cacheCreationCostPerToken
  );
}

function sameTokenRates(a: TokenRates | null, b: TokenRates | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    samePrices(a, b) &&
    a.promptTiers.length === b.promptTiers.length &&
    a.promptTiers.every((tier, index) => {
      const other = b.promptTiers[index];
      return (
        other !== undefined &&
        tier.aboveTokens === other.aboveTokens &&
        samePrices(tier.prices, other.prices)
      );
    })
  );
}

// Resellers often omit speed tiers, so a missing tier fills from the other entry instead of conflicting.
function mergeAliasRate(a: ModelRate, b: ModelRate): ModelRate | null {
  const fast = a.fast ?? b.fast;
  const ultrafast = a.ultrafast ?? b.ultrafast;
  if (
    !sameTokenRates(a, b) ||
    !sameTokenRates(fast, b.fast ?? fast) ||
    !sameTokenRates(ultrafast, b.ultrafast ?? ultrafast)
  ) {
    return null;
  }
  return { ...a, fast, ultrafast };
}

function ratesAt(rate: ModelRate, speed: UsageSpeed): TokenRates {
  return (speed === "standard" ? null : rate[speed]) ?? rate;
}

// A request over a prompt tier pays that tier's prices for every token type.
function pricesFor(rates: TokenRates, promptTokens: number): TokenPrices {
  let prices: TokenPrices = rates;
  for (const tier of rates.promptTiers) {
    if (promptTokens > tier.aboveTokens) prices = tier.prices;
  }
  return prices;
}

function promptTokensOf(totals: UsageTokenTotals): number {
  return totals.uncachedInputTokens + totals.cachedInputTokens + totals.cacheCreationTokens;
}

function normalizeRateKey(model: string): string {
  return model.trim().toLowerCase();
}

function bareModelName(key: string): string {
  const slash = key.lastIndexOf("/");
  return slash === -1 ? key : key.slice(slash + 1);
}

// Price Claude's bracketed context variants at the base tier, the only name the rate table knows.
function stripVariantSuffix(key: string): string {
  const bracket = key.indexOf("[");
  return bracket === -1 ? key : key.slice(0, bracket);
}

// Synthetic messages are unbilled; bare family names are generation-ambiguous and remain unpriced.
const UNPRICEABLE_MODELS = new Set([
  "<synthetic>",
  "synthetic",
  "opus",
  "sonnet",
  "haiku",
  "fable",
]);

// Immutable tables permit caching rates across twice-per-record pricing lookups.
const resolvedRates = new WeakMap<RateTable, Map<string, ModelRate | null>>();

export function lookupRate(table: RateTable, model: string): ModelRate | null {
  let resolved = resolvedRates.get(table);
  if (resolved === undefined) {
    resolved = new Map();
    resolvedRates.set(table, resolved);
  }
  let rate = resolved.get(model);
  if (rate === undefined) {
    rate = resolveRate(table, model);
    resolved.set(model, rate);
  }
  return rate;
}

function resolveRate(table: RateTable, model: string): ModelRate | null {
  const key = stripVariantSuffix(normalizeRateKey(model));
  const bareName = bareModelName(key);
  if (bareName.length === 0 || UNPRICEABLE_MODELS.has(bareName)) return null;
  return table.get(key) ?? null;
}

export type PricedRecord = Pick<
  UsageRecord,
  "model" | "rateModel" | "totals" | "speed" | "reportedCostUsd"
>;

export interface PricedUsage {
  readonly costUsd: number;
  readonly costSource: UsageCostSource;
  readonly categoryCostUsd: UsageCategoryCost | null;
  readonly speedPremiumUsd: number;
}

function costByCategory(totals: UsageTokenTotals, prices: TokenPrices): UsageCategoryCost {
  return {
    input: totals.uncachedInputTokens * prices.inputCostPerToken,
    cacheRead: totals.cachedInputTokens * prices.cacheReadCostPerToken,
    cacheWrite: totals.cacheCreationTokens * prices.cacheCreationCostPerToken,
    output: totals.outputTokens * prices.outputCostPerToken,
  };
}

function sumCategories(cost: UsageCategoryCost): number {
  return cost.input + cost.cacheRead + cost.cacheWrite + cost.output;
}

/** Reasoning tokens are already included in outputTokens; do not charge twice. */
export function priceUsage(
  table: RateTable,
  record: PricedRecord,
  overrides?: RateTable,
): PricedUsage {
  const { model, totals, reportedCostUsd } = record;
  const override = overrides?.get(model.trim());
  const reported =
    override === undefined && reportedCostUsd !== null && Number.isFinite(reportedCostUsd)
      ? reportedCostUsd
      : null;
  const unsplit = (costUsd: number, costSource: UsageCostSource): PricedUsage => ({
    costUsd,
    costSource,
    categoryCostUsd: null,
    speedPremiumUsd: 0,
  });
  const rate = override ?? lookupRate(table, record.rateModel ?? model);
  if (rate === null) {
    return reported === null ? unsplit(0, "unpriced") : unsplit(reported, "providerReported");
  }

  const prompt = promptTokensOf(totals);
  const listCost = costByCategory(totals, pricesFor(ratesAt(rate, record.speed), prompt));
  const listCostUsd = sumCategories(listCost);
  if (reported !== null && listCostUsd <= 0) return unsplit(reported, "providerReported");
  const premiumUsd =
    record.speed === "standard"
      ? 0
      : listCostUsd - sumCategories(costByCategory(totals, pricesFor(rate, prompt)));
  const scale = reported === null ? 1 : reported / listCostUsd;
  return {
    costUsd: reported ?? listCostUsd,
    costSource: reported === null ? "modelPriced" : "providerReported",
    categoryCostUsd: {
      input: listCost.input * scale,
      cacheRead: listCost.cacheRead * scale,
      cacheWrite: listCost.cacheWrite * scale,
      output: listCost.output * scale,
    },
    speedPremiumUsd: premiumUsd * scale,
  };
}

export function cacheSavingsUsd(
  table: RateTable,
  record: PricedRecord,
  overrides?: RateTable,
): number {
  const rate =
    overrides?.get(record.model.trim()) ?? lookupRate(table, record.rateModel ?? record.model);
  if (rate === null) return 0;
  const prices = pricesFor(ratesAt(rate, record.speed), promptTokensOf(record.totals));
  return (
    record.totals.cachedInputTokens * (prices.inputCostPerToken - prices.cacheReadCostPerToken)
  );
}
