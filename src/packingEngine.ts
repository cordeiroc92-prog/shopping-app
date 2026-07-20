// packingEngine.ts
// Pure, framework-agnostic packing engine for FLY.
//
// Give it a closet (from the swipe onboarding) and a trip (from the planner),
// and it decides, per stop, for every need:
//   pack   -> bring this owned item, it earns its space here
//   rewear -> an already-packed item also covers this stop, no extra bag cost
//   gap    -> nothing owned satisfies this need, recommend buying it
//
// No React and no network calls live here, so it is easy to unit test.
// Feed each stop real weather from stopClimate.ts before calling this.

export type Category =
  | "top" | "bottom" | "dress" | "outerwear"
  | "shoes" | "swim" | "accessory";

export type Formality = "casual" | "smart" | "formal";

export type Activity = "city" | "beach" | "hike" | "dinner" | "active";

// A closet item. Every archetype in your seed catalog carries this metadata,
// which is what lets the engine reason precisely without asking the user anything.
export interface ClosetItem {
  id: string;
  name: string;
  category: Category;
  minTempC: number;          // comfortable band, low end
  maxTempC: number;          // comfortable band, high end
  formality: Formality;
  suitableFor: Activity[];   // empty means general purpose
  waterSafe?: boolean;       // fine to get wet / quick dry
  rainReady?: boolean;       // sheds rain
  rewearDays: number;        // wears before a wash: tee ~1, shorts ~2, jeans ~4, blazer ~6
  loved?: boolean;           // came through the swipe as a "love"
  bulky?: boolean;           // costs suitcase space, avoid packing duplicates
}

export interface Stop {
  id: string;
  name: string;
  nights: number;
  tempHighC: number;
  tempLowC: number;
  rainChance?: number;       // 0..1
  activities: Activity[];    // what they will actually do here
}

export interface Trip {
  stops: Stop[];
  laundryEveryDays?: number; // access to laundry every N days, default 6
}

export interface EngineConfig {
  laundryEveryDays: number;
  coldTempC: number;         // daytime low below this wants a warm layer
  hotTempC: number;          // high above this wants breathable pieces
  rainThreshold: number;     // rainChance above this wants rain gear
  tempToleranceC: number;    // slack on the comfort band
  categoryRewearDays: Record<Category, number>;
  weights: {
    loved: number;
    activityExact: number;
    versatility: number;
    tempCenter: number;
  };
}

export const DEFAULT_CONFIG: EngineConfig = {
  laundryEveryDays: 6,
  coldTempC: 15,
  hotTempC: 24,
  rainThreshold: 0.4,
  tempToleranceC: 3,
  categoryRewearDays: {
    top: 1, bottom: 3, dress: 1, swim: 2,
    outerwear: 99, shoes: 99, accessory: 99,
  },
  weights: { loved: 5, activityExact: 2, versatility: 2, tempCenter: 1 },
};

// A single thing a stop requires. Assignment tries to fill these from the closet.
interface Need {
  stopId: string;
  slot: string;                 // human label, drives the reason line
  categories: Category[];       // acceptable categories
  activity: Activity | "any";
  minFormality: number;         // 0..2
  maxFormality: number;
  quantity: number;             // distinct items wanted for this stop
  requireWaterSafe?: boolean;
  requireRainReady?: boolean;
  requireWarm?: boolean;        // must be comfortable down to the stop low
  breathable?: boolean;         // hot stop, exclude items that top out below the high
  reason: string;
  priority: number;             // higher surfaces first when it becomes a gap
}

export type ItemStatus = "pack" | "rewear";

export interface StopLine {
  itemId: string;
  name: string;
  status: ItemStatus;
  roles: string[];              // which slots this item fills at this stop
}

export interface Gap {
  stopId: string;
  stopName: string;
  slot: string;
  suggestedCategory: Category;
  reason: string;
  priority: number;
}

export interface PackedItem {
  item: ClosetItem;
  coversStops: string[];        // stop names this piece works across
  roles: string[];              // slots it fills anywhere on the trip
}

export interface PackingPlan {
  packed: PackedItem[];
  gaps: Gap[];
  byStop: Record<string, { stopName: string; lines: StopLine[]; gaps: Gap[] }>;
  stats: { itemsPacked: number; rewears: number; gapCount: number };
}

const FORMALITY_RANK: Record<Formality, number> = { casual: 0, smart: 1, formal: 2 };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// ---- need derivation -------------------------------------------------------

function buildStopNeeds(stop: Stop, cfg: EngineConfig): Need[] {
  const days = Math.max(1, stop.nights);
  const cycle = Math.min(days, cfg.laundryEveryDays);
  const hot = stop.tempHighC > cfg.hotTempC;
  const cold = stop.tempLowC < cfg.coldTempC;
  const rainy = (stop.rainChance ?? 0) > cfg.rainThreshold;
  const needs: Need[] = [];

  needs.push({
    stopId: stop.id, slot: "day top",
    categories: ["top", "dress"], activity: "any",
    minFormality: 0, maxFormality: 1,
    quantity: clamp(Math.ceil(cycle / cfg.categoryRewearDays.top), 2, 7),
    breathable: hot,
    reason: hot ? `breathable tops for ${stop.tempHighC}\u00B0 days` : "day tops",
    priority: 3,
  });

  needs.push({
    stopId: stop.id, slot: "day bottom",
    categories: ["bottom", "dress"], activity: "any",
    minFormality: 0, maxFormality: 1,
    quantity: clamp(Math.ceil(cycle / cfg.categoryRewearDays.bottom), 1, 4),
    breathable: hot,
    reason: "day bottoms",
    priority: 3,
  });

  needs.push({
    stopId: stop.id, slot: "walking shoes",
    categories: ["shoes"], activity: "city",
    minFormality: 0, maxFormality: 1, quantity: 1,
    reason: `walking around ${stop.name}`,
    priority: 4,
  });

  if (stop.activities.includes("beach")) {
    needs.push({
      stopId: stop.id, slot: "swimwear",
      categories: ["swim"], activity: "beach",
      minFormality: 0, maxFormality: 0,
      quantity: clamp(Math.ceil(days / 4), 1, 2),
      requireWaterSafe: true,
      reason: "beach and swim days", priority: 5,
    });
    needs.push({
      stopId: stop.id, slot: "sandals",
      categories: ["shoes"], activity: "beach",
      minFormality: 0, maxFormality: 1, quantity: 1,
      requireWaterSafe: true,
      reason: "coastal wear", priority: 3,
    });
  }

  if (stop.activities.includes("hike")) {
    needs.push({
      stopId: stop.id, slot: "trail shoes",
      categories: ["shoes"], activity: "hike",
      minFormality: 0, maxFormality: 0, quantity: 1,
      reason: `hiking near ${stop.name}`, priority: 5,
    });
  }

  if (stop.activities.includes("dinner")) {
    // One elevated look. A dress satisfies it outright, or a smart blazer does.
    needs.push({
      stopId: stop.id, slot: "dinner look",
      categories: ["dress", "outerwear"], activity: "dinner",
      minFormality: 1, maxFormality: 2, quantity: 1,
      reason: "a nice evening out", priority: 4,
    });
  }

  if (cold) {
    needs.push({
      stopId: stop.id, slot: "warm layer",
      categories: ["outerwear"], activity: "any",
      minFormality: 0, maxFormality: 2, quantity: 1,
      requireWarm: true,
      reason: `cooler evenings, down to ${stop.tempLowC}\u00B0`, priority: 4,
    });
  }

  if (rainy) {
    needs.push({
      stopId: stop.id, slot: "rain layer",
      categories: ["outerwear"], activity: "any",
      minFormality: 0, maxFormality: 2, quantity: 1,
      requireRainReady: true,
      reason: "rain in the forecast", priority: 4,
    });
  }

  return needs;
}

// ---- eligibility and scoring ----------------------------------------------

function isEligible(item: ClosetItem, need: Need, stop: Stop, cfg: EngineConfig): boolean {
  if (!need.categories.includes(item.category)) return false;

  const rank = FORMALITY_RANK[item.formality];
  if (rank < need.minFormality || rank > need.maxFormality) return false;

  if (need.requireWaterSafe && !item.waterSafe) return false;
  if (need.requireRainReady && !item.rainReady) return false;

  // Activity match. Beach and hike are strict, general items do not count.
  if (need.activity !== "any") {
    const strict = need.activity === "beach" || need.activity === "hike"
      || need.activity === "dinner";
    const suits = item.suitableFor.includes(need.activity);
    if (strict && !suits) return false;
    if (!strict && item.suitableFor.length > 0 && !suits) return false;
  }

  const tol = cfg.tempToleranceC;
  if (need.requireWarm) {
    // A warm layer only counts if it is comfortable down to the stop low.
    if (item.minTempC > stop.tempLowC + tol) return false;
    return true;
  }

  // Day comfort: the stop high should sit inside the item band (with slack).
  if (stop.tempHighC < item.minTempC - tol) return false;
  if (stop.tempHighC > item.maxTempC + tol) return false;

  // On hot stops, day pieces must actually breathe up to the high.
  if (need.breathable && item.maxTempC < stop.tempHighC - tol) return false;

  return true;
}

function scoreItem(item: ClosetItem, need: Need, stop: Stop, cfg: EngineConfig): number {
  const w = cfg.weights;
  let score = 0;

  if (item.loved) score += w.loved;

  if (need.activity !== "any" && item.suitableFor.includes(need.activity)) {
    score += w.activityExact;
  }

  // Versatility: pieces you can rewear a lot, and are not bulky, share well.
  score += (Math.min(item.rewearDays, 6) / 6) * w.versatility;
  if (item.bulky) score -= 1;

  // Temperature centering: comfiest when the high sits mid band.
  const mid = (item.minTempC + item.maxTempC) / 2;
  const halfSpan = Math.max(1, (item.maxTempC - item.minTempC) / 2);
  const dist = Math.min(1, Math.abs(stop.tempHighC - mid) / halfSpan);
  score += (1 - dist) * w.tempCenter;

  return score;
}

// ---- main entry point ------------------------------------------------------

export function buildPackingPlan(
  closet: ClosetItem[],
  trip: Trip,
  config: Partial<EngineConfig> = {},
): PackingPlan {
  const cfg: EngineConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    categoryRewearDays: { ...DEFAULT_CONFIG.categoryRewearDays, ...(config.categoryRewearDays ?? {}) },
    weights: { ...DEFAULT_CONFIG.weights, ...(config.weights ?? {}) },
  };

  const packed = new Map<string, PackedItem>();
  const byStop: PackingPlan["byStop"] = {};
  const gaps: Gap[] = [];
  let rewears = 0;

  for (const stop of trip.stops) {
    byStop[stop.id] = { stopName: stop.name, lines: [], gaps: [] };
    const lineIndex = new Map<string, StopLine>();

    const record = (item: ClosetItem, status: ItemStatus, role: string) => {
      let line = lineIndex.get(item.id);
      if (!line) {
        line = { itemId: item.id, name: item.name, status, roles: [] };
        lineIndex.set(item.id, line);
        byStop[stop.id].lines.push(line);
      }
      // A piece newly packed here reads as pack even if it also rewears a slot.
      if (status === "pack") line.status = "pack";
      if (!line.roles.includes(role)) line.roles.push(role);
    };

    const needs = buildStopNeeds(stop, cfg);

    for (const need of needs) {
      let remaining = need.quantity;
      const usedHere = new Set<string>();

      // 1. Rewear: items already in the bag that also work here.
      const alreadyPacked = [...packed.values()]
        .filter((p) => !usedHere.has(p.item.id) && isEligible(p.item, need, stop, cfg))
        .sort((a, b) => scoreItem(b.item, need, stop, cfg) - scoreItem(a.item, need, stop, cfg));

      for (const p of alreadyPacked) {
        if (remaining <= 0) break;
        usedHere.add(p.item.id);
        if (!p.coversStops.includes(stop.name)) p.coversStops.push(stop.name);
        if (!p.roles.includes(need.slot)) p.roles.push(need.slot);
        record(p.item, "rewear", need.slot);
        rewears++;
        remaining--;
      }

      // 2. Pack: new items from the closet, best fit first.
      if (remaining > 0) {
        const fresh = closet
          .filter((it) => !packed.has(it.id) && !usedHere.has(it.id)
            && isEligible(it, need, stop, cfg))
          .sort((a, b) => scoreItem(b, need, stop, cfg) - scoreItem(a, need, stop, cfg));

        for (const it of fresh) {
          if (remaining <= 0) break;
          usedHere.add(it.id);
          packed.set(it.id, { item: it, coversStops: [stop.name], roles: [need.slot] });
          record(it, "pack", need.slot);
          remaining--;
        }
      }

      // 3. Gap: nothing owned satisfies what is left.
      while (remaining > 0) {
        const gap: Gap = {
          stopId: stop.id,
          stopName: stop.name,
          slot: need.slot,
          suggestedCategory: need.categories[0],
          reason: need.reason,
          priority: need.priority,
        };
        gaps.push(gap);
        byStop[stop.id].gaps.push(gap);
        remaining--;
      }
    }
  }

  gaps.sort((a, b) => b.priority - a.priority);

  return {
    packed: [...packed.values()],
    gaps,
    byStop,
    stats: { itemsPacked: packed.size, rewears, gapCount: gaps.length },
  };
}
