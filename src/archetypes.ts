// archetypes.ts
// The structured metadata behind every swipe card.
//
// An Archetype is a catalog template ("linen shorts", "navy blazer"). When a user
// swipes "own it" or "love", you turn it into a ClosetItem the packing engine reads.
// Because the attributes live on the archetype, every owned item arrives fully
// described, no photo classification and no questions asked. That is what lets the
// engine pack precisely off a closet the user built in ninety seconds of swiping.
//
// Attribute conventions (keep these consistent so the engine behaves predictably):
//   minTempC / maxTempC  comfortable daytime band. Summer-only piece ~ 21..40,
//                        all-season tee ~ 16..40, sweater ~ -5..18, winter coat ~ -12..12.
//   rewearDays           wears before a wash. tee 1, shirt 2, shorts 2, chinos 3,
//                        jeans 4, dress 1, sweater 4, blazer 6, coat 8, shoes 99.
//   formality            casual | smart | formal.
//   suitableFor          leave empty for general pieces; be specific for beach,
//                        hike, dinner, active so the engine can match activities.

import type { Category, Formality, Activity, ClosetItem } from "./packingEngine";

export type StyleTag =
  | "minimal" | "classic" | "sporty" | "coastal"
  | "streetwear" | "smart-casual" | "bold" | "cozy";

export interface Archetype {
  id: string;               // stable slug, also becomes the ClosetItem id
  name: string;             // display name on the swipe card
  category: Category;
  icon: string;             // Tabler icon name for the card
  minTempC: number;
  maxTempC: number;
  formality: Formality;
  suitableFor: Activity[];
  rewearDays: number;
  waterSafe?: boolean;
  rainReady?: boolean;
  bulky?: boolean;
  styleTags: StyleTag[];    // feeds the taste graph from "love" swipes
  deckOrder: number;        // lower shows first, so the closet fills breadth-first
  essential?: boolean;      // core staples surfaced in the first pass
}

// Turn a swiped archetype into an owned closet item the engine consumes.
export function ownArchetype(a: Archetype, opts: { loved?: boolean } = {}): ClosetItem {
  return {
    id: a.id,
    name: a.name,
    category: a.category,
    minTempC: a.minTempC,
    maxTempC: a.maxTempC,
    formality: a.formality,
    suitableFor: [...a.suitableFor],
    waterSafe: a.waterSafe,
    rainReady: a.rainReady,
    rewearDays: a.rewearDays,
    bulky: a.bulky,
    loved: opts.loved ?? false,
  };
}

// Build a closet from swipe results in one call.
export function closetFromSwipes(
  results: { archetypeId: string; loved?: boolean }[],
): ClosetItem[] {
  const byId = new Map(ARCHETYPES.map((a) => [a.id, a]));
  const closet: ClosetItem[] = [];
  for (const r of results) {
    const a = byId.get(r.archetypeId);
    if (a) closet.push(ownArchetype(a, { loved: r.loved }));
  }
  return closet;
}

// Ordered deck for the swipe onboarding. Essentials first, then breadth.
export function getSwipeDeck(): Archetype[] {
  return [...ARCHETYPES].sort((a, b) =>
    Number(b.essential ?? false) - Number(a.essential ?? false) || a.deckOrder - b.deckOrder,
  );
}

// ---- seed catalog ----------------------------------------------------------
// A versatile starter set. Extend freely; the two files above never change.

export const ARCHETYPES: Archetype[] = [
  // tops
  { id: "tee-basic", name: "Plain tees", category: "top", icon: "ti-shirt", minTempC: 16, maxTempC: 40, formality: "casual", suitableFor: [], rewearDays: 1, styleTags: ["minimal", "classic"], deckOrder: 1, essential: true },
  { id: "tee-graphic", name: "Graphic tees", category: "top", icon: "ti-shirt", minTempC: 16, maxTempC: 40, formality: "casual", suitableFor: [], rewearDays: 1, styleTags: ["streetwear", "bold"], deckOrder: 2 },
  { id: "tank-top", name: "Tank tops", category: "top", icon: "ti-shirt", minTempC: 22, maxTempC: 40, formality: "casual", suitableFor: ["beach", "active"], waterSafe: true, rewearDays: 1, styleTags: ["sporty", "coastal"], deckOrder: 3 },
  { id: "shirt-oxford", name: "Oxford shirt", category: "top", icon: "ti-hanger", minTempC: 12, maxTempC: 28, formality: "smart", suitableFor: ["city", "dinner"], rewearDays: 2, styleTags: ["classic", "smart-casual"], deckOrder: 4, essential: true },
  { id: "shirt-linen", name: "Linen shirt", category: "top", icon: "ti-hanger", minTempC: 20, maxTempC: 40, formality: "smart", suitableFor: ["city", "dinner", "beach"], rewearDays: 2, styleTags: ["coastal", "smart-casual"], deckOrder: 5 },
  { id: "polo", name: "Polo shirt", category: "top", icon: "ti-shirt", minTempC: 16, maxTempC: 34, formality: "smart", suitableFor: ["city"], rewearDays: 2, styleTags: ["classic", "smart-casual"], deckOrder: 6 },
  { id: "hoodie", name: "Hoodie", category: "top", icon: "ti-hanger", minTempC: 4, maxTempC: 20, formality: "casual", suitableFor: ["active"], rewearDays: 4, styleTags: ["sporty", "cozy", "streetwear"], deckOrder: 7 },
  { id: "sweater-knit", name: "Knit sweater", category: "top", icon: "ti-hanger", minTempC: -5, maxTempC: 18, formality: "smart", suitableFor: [], rewearDays: 4, styleTags: ["cozy", "classic"], deckOrder: 8 },

  // bottoms
  { id: "jeans-dark", name: "Dark jeans", category: "bottom", icon: "ti-hanger", minTempC: 5, maxTempC: 26, formality: "smart", suitableFor: ["city"], rewearDays: 4, styleTags: ["classic", "smart-casual"], deckOrder: 10, essential: true },
  { id: "chinos", name: "Chino trousers", category: "bottom", icon: "ti-hanger", minTempC: 8, maxTempC: 27, formality: "smart", suitableFor: ["city", "dinner"], rewearDays: 3, styleTags: ["classic", "smart-casual"], deckOrder: 11, essential: true },
  { id: "shorts-casual", name: "Casual shorts", category: "bottom", icon: "ti-hanger", minTempC: 20, maxTempC: 40, formality: "casual", suitableFor: ["city", "beach"], waterSafe: true, rewearDays: 2, styleTags: ["sporty", "coastal"], deckOrder: 12, essential: true },
  { id: "shorts-linen", name: "Linen shorts", category: "bottom", icon: "ti-hanger", minTempC: 22, maxTempC: 40, formality: "smart", suitableFor: ["beach", "city"], waterSafe: true, rewearDays: 2, styleTags: ["coastal", "smart-casual"], deckOrder: 13 },
  { id: "trousers-tailored", name: "Tailored trousers", category: "bottom", icon: "ti-hanger", minTempC: 6, maxTempC: 28, formality: "formal", suitableFor: ["dinner", "city"], rewearDays: 3, styleTags: ["classic"], deckOrder: 14 },
  { id: "leggings", name: "Leggings", category: "bottom", icon: "ti-hanger", minTempC: 2, maxTempC: 30, formality: "casual", suitableFor: ["active", "hike"], rewearDays: 2, styleTags: ["sporty"], deckOrder: 15 },
  { id: "skirt-midi", name: "Midi skirt", category: "bottom", icon: "ti-hanger", minTempC: 16, maxTempC: 34, formality: "smart", suitableFor: ["city", "dinner"], rewearDays: 2, styleTags: ["classic", "smart-casual"], deckOrder: 16 },

  // dresses
  { id: "sundress", name: "Sundress", category: "dress", icon: "ti-dress", minTempC: 21, maxTempC: 40, formality: "smart", suitableFor: ["city", "dinner", "beach"], rewearDays: 1, styleTags: ["coastal", "classic"], deckOrder: 20 },
  { id: "dress-casual", name: "Casual day dress", category: "dress", icon: "ti-dress", minTempC: 18, maxTempC: 36, formality: "smart", suitableFor: ["city"], rewearDays: 1, styleTags: ["minimal", "classic"], deckOrder: 21 },
  { id: "dress-evening", name: "Evening dress", category: "dress", icon: "ti-dress", minTempC: 14, maxTempC: 34, formality: "formal", suitableFor: ["dinner"], rewearDays: 1, styleTags: ["bold", "classic"], deckOrder: 22 },

  // outerwear
  { id: "blazer", name: "Blazer", category: "outerwear", icon: "ti-jacket", minTempC: 10, maxTempC: 26, formality: "smart", suitableFor: ["city", "dinner"], rewearDays: 6, bulky: true, styleTags: ["classic", "smart-casual"], deckOrder: 30, essential: true },
  { id: "denim-jacket", name: "Denim jacket", category: "outerwear", icon: "ti-jacket", minTempC: 8, maxTempC: 22, formality: "casual", suitableFor: ["city"], rewearDays: 6, styleTags: ["classic", "streetwear"], deckOrder: 31 },
  { id: "rain-shell", name: "Rain shell", category: "outerwear", icon: "ti-jacket", minTempC: 2, maxTempC: 22, formality: "casual", suitableFor: ["city", "hike"], rainReady: true, rewearDays: 8, styleTags: ["sporty"], deckOrder: 32 },
  { id: "puffer", name: "Puffer jacket", category: "outerwear", icon: "ti-jacket", minTempC: -12, maxTempC: 10, formality: "casual", suitableFor: ["city"], rewearDays: 8, bulky: true, rainReady: true, styleTags: ["sporty", "cozy"], deckOrder: 33 },
  { id: "wool-coat", name: "Wool coat", category: "outerwear", icon: "ti-jacket", minTempC: -10, maxTempC: 12, formality: "smart", suitableFor: ["city", "dinner"], rewearDays: 8, bulky: true, styleTags: ["classic"], deckOrder: 34 },

  // shoes
  { id: "sneakers", name: "White sneakers", category: "shoes", icon: "ti-shoe", minTempC: 0, maxTempC: 40, formality: "casual", suitableFor: ["city", "active"], rewearDays: 99, styleTags: ["minimal", "sporty"], deckOrder: 40, essential: true },
  { id: "sandals", name: "Leather sandals", category: "shoes", icon: "ti-shoe", minTempC: 18, maxTempC: 40, formality: "smart", suitableFor: ["beach", "city"], waterSafe: true, rewearDays: 99, styleTags: ["coastal", "classic"], deckOrder: 41 },
  { id: "trail-shoes", name: "Trail shoes", category: "shoes", icon: "ti-shoe", minTempC: -5, maxTempC: 34, formality: "casual", suitableFor: ["hike", "active"], rainReady: true, rewearDays: 99, styleTags: ["sporty"], deckOrder: 42 },
  { id: "dress-shoes", name: "Dress shoes", category: "shoes", icon: "ti-shoe", minTempC: -5, maxTempC: 34, formality: "formal", suitableFor: ["dinner", "city"], rewearDays: 99, styleTags: ["classic"], deckOrder: 43 },
  { id: "boots", name: "Ankle boots", category: "shoes", icon: "ti-shoe", minTempC: -12, maxTempC: 18, formality: "smart", suitableFor: ["city"], rainReady: true, rewearDays: 99, bulky: true, styleTags: ["classic", "streetwear"], deckOrder: 44 },

  // swim
  { id: "swim-trunks", name: "Swim shorts", category: "swim", icon: "ti-ripple", minTempC: 20, maxTempC: 40, formality: "casual", suitableFor: ["beach"], waterSafe: true, rewearDays: 2, styleTags: ["coastal", "sporty"], deckOrder: 50 },
  { id: "swimsuit", name: "Swimsuit", category: "swim", icon: "ti-ripple", minTempC: 20, maxTempC: 40, formality: "casual", suitableFor: ["beach"], waterSafe: true, rewearDays: 2, styleTags: ["coastal"], deckOrder: 51 },

  // accessories
  { id: "sun-hat", name: "Sun hat", category: "accessory", icon: "ti-hat", minTempC: 20, maxTempC: 40, formality: "casual", suitableFor: ["beach", "city"], waterSafe: true, rewearDays: 99, styleTags: ["coastal"], deckOrder: 60 },
  { id: "beanie", name: "Beanie", category: "accessory", icon: "ti-hat", minTempC: -12, maxTempC: 10, formality: "casual", suitableFor: ["city"], rewearDays: 99, styleTags: ["cozy", "sporty"], deckOrder: 61 },
  { id: "scarf", name: "Scarf", category: "accessory", icon: "ti-wind", minTempC: -12, maxTempC: 14, formality: "smart", suitableFor: [], rewearDays: 99, styleTags: ["classic", "cozy"], deckOrder: 62 },
  { id: "sunglasses", name: "Sunglasses", category: "accessory", icon: "ti-sunglasses", minTempC: 8, maxTempC: 40, formality: "casual", suitableFor: ["beach", "city"], rewearDays: 99, styleTags: ["minimal", "coastal"], deckOrder: 63 },
];
