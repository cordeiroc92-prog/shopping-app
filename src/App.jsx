import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  Plus, X, Sparkles, Tag, ExternalLink,
  Bell, Store, ChevronDown, Check, BellOff,
  Cloud, CloudRain, Sun, CloudSun, MapPin, Luggage, ChevronRight, ShoppingBag,
  Heart, ArrowLeft, HelpCircle, Plane, Library, Search,
  Star, RotateCcw, Compass, Lock, Globe,
} from "lucide-react";

/* ---------------------------------------------------
   SHARED TOKENS + HELPERS
   paper #EDE7DD, ink #211D18, sage #74856A (matched/good),
   clay #B85C38 (sale/alert), gold #C79A44 (accent)
--------------------------------------------------- */

const FONT_DISPLAY = "'Fraunces', 'Georgia', serif";
const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', 'Courier New', monospace";

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function colorDistance(a, b) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}
function avgColor(hexes) {
  if (hexes.length === 0) return "#8A8172";
  const rgbs = hexes.map(hexToRgb);
  const avg = rgbs
    .reduce((acc, [r, g, b]) => [acc[0] + r, acc[1] + g, acc[2] + b], [0, 0, 0])
    .map((v) => Math.round(v / rgbs.length));
  return `#${avg.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// Shared scoring engine: ranks a catalog item against a style profile
// (the pins on the mood board), optionally weighted toward one focal pin.
function scoreAgainstBoard(item, board, focalPin) {
  const factors = [];
  let total = 0;
  if (board.length === 0) return { total: 0, factors: [] };

  if (focalPin) {
    const sameTagCount = board.filter((p) => p.tag === item.tag).length;
    const clickedMatches = item.tag === focalPin.tag;
    let catScore = 0;
    if (clickedMatches) catScore += 2.2;
    if (sameTagCount >= 2) catScore += 1.3;
    if (catScore > 0) {
      factors.push({
        detail: clickedMatches ? `matches "${focalPin.tag}" you pinned` : `"${item.tag}" appears ${sameTagCount}x on your board`,
        weight: catScore,
      });
      total += catScore;
    }
    const dFocal = colorDistance(item.color, focalPin.color);
    const focalColorScore = Math.max(0, 2.4 - dFocal / 90);
    if (focalColorScore > 0.3) {
      factors.push({ detail: "close tonal match to the piece you pinned", weight: focalColorScore });
      total += focalColorScore;
    }
  } else {
    const sameTagCount = board.filter((p) => p.tag === item.tag || p.tag === item.category).length;
    if (sameTagCount > 0) {
      factors.push({ detail: `matches ${sameTagCount} piece${sameTagCount > 1 ? "s" : ""} on your board`, weight: 1.6 });
      total += 1.6;
    }
  }

  const boardAvg = avgColor(board.map((p) => p.color));
  const dBoard = colorDistance(item.color, boardAvg);
  const boardColorScore = Math.max(0, 1.4 - dBoard / 130);
  if (boardColorScore > 0.3) {
    factors.push({ detail: "fits your board's overall palette", weight: boardColorScore });
    total += boardColorScore;
  }

  const avgPrice = board.reduce((s, p) => s + p.price, 0) / board.length;
  const priceDelta = Math.abs(item.price - avgPrice) / Math.max(avgPrice, 1);
  const priceScore = Math.max(0, 1.4 - priceDelta * 1.6);
  if (priceScore > 0.25) {
    factors.push({ detail: `near your board's typical $${Math.round(avgPrice)} spend`, weight: priceScore });
    total += priceScore;
  }

  // "You already like this store" only means something for a real brand. Amazon
  // is a generic marketplace every item currently links through, so counting it
  // would give every card the same meaningless boost — skip it.
  if (item.store && item.store !== "Amazon") {
    const sameStoreCount = board.filter((p) => p.store === item.store).length;
    if (sameStoreCount > 0) {
      factors.push({ detail: `you already like ${item.store}`, weight: 0.7 });
      total += 0.7;
    }
  }

  const onSale = item.was && item.was > item.price;
  if (onSale) {
    factors.push({ detail: `${Math.round((1 - item.price / item.was) * 100)}% off right now`, weight: 0.5 });
    total += 0.5;
  }

  return { total, factors: factors.sort((a, b) => b.weight - a.weight) };
}

/* ---------------------------------------------------
   STARTER DATA
--------------------------------------------------- */

const SWATCHES = [
  { hue: "#C79A44", name: "amber" }, { hue: "#74856A", name: "sage" },
  { hue: "#B85C38", name: "clay" }, { hue: "#5B6B8C", name: "denim" },
  { hue: "#8C6A5B", name: "umber" }, { hue: "#A8785B", name: "terracotta" },
  { hue: "#3E4A3D", name: "forest" }, { hue: "#C4A5A0", name: "rose dust" },
];

// Resolves a free-text colour name (from manual entry or imported real
// product data, e.g. "light birch/black", "cream", "wlsn strp crfl bl/wht")
// to a visual hex swatch. Real retailer colour names rarely match the app's
// 8 curated swatch names, so this checks for common colour words anywhere
// in the string and falls back to a neutral grey rather than guessing wrong.
const COLOUR_WORD_MAP = {
  black: "#2A2622", white: "#EDE8DE", cream: "#E4DAC4", ivory: "#EDE6D6",
  birch: "#D8CFBE", beige: "#D9C8AE", tan: "#C7A87A", brown: "#6B4B34",
  camel: "#C08A52", blue: "#5B6B8C", navy: "#2E3A52", denim: "#5B6B8C",
  green: "#3E4A3D", olive: "#5C5A3D", sage: "#74856A", red: "#8B3A2E",
  pink: "#C4A5A0", rose: "#C4A5A0", grey: "#8A8172", gray: "#8A8172",
  yellow: "#C79A44", gold: "#C79A44", amber: "#C79A44", orange: "#A8785B",
  terracotta: "#A8785B", rust: "#B85C38", clay: "#B85C38", purple: "#6B5B7A",
  lavender: "#9B8FA8", multi: "#8A8172", stripe: "#8A8172",
};
function resolveColour(input) {
  if (!input) return "#8A8172";
  if (/^#[0-9A-Fa-f]{6}$/.test(input.trim())) return input.trim();
  const lower = input.toLowerCase();
  const exact = SWATCHES.find((s) => s.name === lower);
  if (exact) return exact.hue;
  for (const [word, hex] of Object.entries(COLOUR_WORD_MAP)) {
    if (lower.includes(word)) return hex;
  }
  return "#8A8172"; // neutral fallback for unrecognized colour text
}

// Maps a store/feed category string onto the app's store-style taxonomy so the
// Discover filter, the closet, and shop matching all speak the same language.
// Feed products arrive with whatever wording the merchant uses ("Jackets",
// "T-Shirts"); this folds those into the nine categories the app understands.
const CATEGORY_ALIASES = {
  top: "tops", tops: "tops", tee: "tops", "t-shirt": "tops", tshirt: "tops", shirt: "tops", shirts: "tops", blouse: "tops",
  knit: "knitwear", knitwear: "knitwear", sweater: "knitwear", jumper: "knitwear", cardigan: "knitwear",
  outerwear: "outerwear", jacket: "outerwear", jackets: "outerwear", coat: "outerwear", coats: "outerwear", raincoat: "outerwear", blazer: "outerwear",
  bottom: "bottoms", bottoms: "bottoms", trouser: "bottoms", trousers: "bottoms", pant: "bottoms", pants: "bottoms", jean: "bottoms", jeans: "bottoms", denim: "bottoms", short: "bottoms", shorts: "bottoms", skirt: "bottoms", tailoring: "bottoms",
  dress: "dresses", dresses: "dresses",
  shoe: "shoes", shoes: "shoes", footwear: "shoes", boot: "shoes", sneaker: "shoes", sandal: "shoes",
  swim: "swimwear", swimwear: "swimwear", swimsuit: "swimwear",
  bag: "bags", bags: "bags", handbag: "bags", tote: "bags", backpack: "bags",
  accessory: "accessories", accessories: "accessories", belt: "accessories", scarf: "accessories", hat: "accessories", sunglasses: "accessories",
};
function normalizeCategory(raw) {
  if (!raw) return "accessories";
  const key = String(raw).trim().toLowerCase();
  if (CATEGORY_ALIASES[key]) return CATEGORY_ALIASES[key];
  for (const [word, cat] of Object.entries(CATEGORY_ALIASES)) {
    if (key.includes(word)) return cat;
  }
  return key; // unknown wording — keep it so it's at least filterable
}

// Keyword dictionary for auto-tagging climate from a product's name and
// description. Feed products arrive with no weather signal at all, only a
// merchant category, so this is what stops a wool sweater and a linen tank
// both defaulting to "any" and showing up on every trip regardless of
// forecast. Ordered rain > water > cool > warm on purpose: a "waterproof
// swim" item should read as rain gear before it reads as beachwear, since
// rain is the more specific, more actionable signal for packing.
const CLIMATE_KEYWORDS = {
  rain: [
    "rain", "raincoat", "waterproof", "water-resistant", "water resistant",
    "showerproof", "anorak", "poncho", "storm", "weatherproof", "drizzle",
  ],
  water: [
    "swim", "swimsuit", "swimwear", "bikini", "board short", "boardshort",
    "trunks", "one-piece", "one piece", "rashguard", "rash guard", "bathing suit",
  ],
  cool: [
    "wool", "cashmere", "fleece", "thermal", "puffer", "parka", "quilted",
    "shearling", "corduroy", "flannel", "sherpa", "insulated", "heavyweight",
    "knit", "sweater", "jumper", "cardigan", "turtleneck", "overcoat",
    "peacoat", "wind-proof", "down jacket", "chunky knit", "fleece-lined",
  ],
  warm: [
    "linen", "seersucker", "lightweight", "breathable", "mesh", "tank",
    "sleeveless", "shorts", "sandal", "flip flop", "sundress", "poplin",
    "short sleeve", "crop top", "sun hat", "sunglasses", "beach", "tropical",
  ],
};
const CLIMATE_PRIORITY = ["rain", "water", "cool", "warm"];

// Scans a product's name and description for climate keywords, scores each
// climate by how many terms match, and returns the strongest signal. Falls
// back to a category-based default when nothing in the text gives a clue,
// so it degrades gracefully instead of leaving items untagged.
function inferClimate(name, description, category) {
  const text = `${name || ""} ${description || ""}`.toLowerCase();
  const scores = { rain: 0, water: 0, cool: 0, warm: 0 };
  for (const climate of CLIMATE_PRIORITY) {
    for (const term of CLIMATE_KEYWORDS[climate]) {
      if (text.includes(term)) scores[climate] += 1;
    }
  }
  let best = null;
  let bestScore = 0;
  for (const climate of CLIMATE_PRIORITY) {
    if (scores[climate] > bestScore) {
      best = climate;
      bestScore = scores[climate];
    }
  }
  if (best) return best;
  // No keyword hit — fall back to the category's usual climate.
  switch (category) {
    case "tops": return "warm";
    case "knitwear": return "cool";
    case "outerwear": return "cool";
    case "swimwear": return "water";
    default: return "any";
  }
}

/* ---------------------------------------------------
   DORMANT — kept intentionally, not dead code.
   These helpers powered manual product entry + bulk spreadsheet import.
   The Discover swipe feed replaced that UI, but this logic is the intended
   ingestion path for affiliate product feeds once approved: a feed is just
   structured rows (title/store/price/image/link), which is exactly what
   parseImport + proxied() already handle. Do not delete.
--------------------------------------------------- */

// Routes a raw retailer image URL through the image proxy so it loads inside
// the app despite retailer hotlink/referer protection. Leaves empty values
// and already-proxied URLs untouched so re-imports don't double-wrap.
const IMAGE_PROXY_BASE = "https://image-proxy-rosy.vercel.app/api/image-proxy?url=";
function proxied(imageUrl) {
  if (!imageUrl) return "";
  const trimmed = imageUrl.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith(IMAGE_PROXY_BASE)) return trimmed; // already wrapped
  return IMAGE_PROXY_BASE + encodeURIComponent(trimmed);
}


const STARTER_PINS = [
  { id: 1, title: "Waffle-knit crewneck", store: "Arket", price: 68, color: "#C4A5A0", tag: "knitwear", category: "knitwear", h: 260, tilt: -2 },
  { id: 2, title: "Wide-leg wool trouser", store: "COS", price: 145, color: "#3E4A3D", tag: "bottoms", category: "bottoms", h: 320, tilt: 1.5 },
  { id: 3, title: "Suede desert boot", store: "Clarks", price: 130, color: "#8C6A5B", tag: "shoes", category: "shoes", h: 230, tilt: -1 },
  { id: 4, title: "Brushed wool overshirt", store: "Toast", price: 175, color: "#5B6B8C", tag: "outerwear", category: "outerwear", h: 300, tilt: 2 },
  { id: 5, title: "Cable-knit scarf", store: "Uniqlo", price: 35, color: "#A8785B", tag: "accessories", category: "accessories", h: 200, tilt: -1.5 },
  { id: 6, title: "Straight denim, raw hem", store: "Levi's", price: 98, color: "#5B6B8C", tag: "bottoms", category: "bottoms", h: 280, tilt: 1 },
];

// Interim shopping catalogue. Until Awin advertiser feeds are approved and
// populated (those bring real brands, deep links and product images), every
// item here is shoppable through our one live partner — Amazon — so the brand
// shown ("Amazon") matches where the link actually goes. buyLinkFor() turns
// each into a tagged Amazon search on its title. `kind` is the fine-grained
// type the shop picker filters on; `popular` seeds the trending fallback shown
// when a user hasn't built a style profile yet. When feed products arrive they
// lead and naturally crowd these out (see allProducts).
const CATALOG = [
  // Tops
  { id: "tk1", title: "Ribbed scoop-neck tank", store: "Amazon", price: 20, was: 26, color: "#EDE8DE", kind: "tank", tag: "tops", category: "tops", climate: "warm", popular: true },
  { id: "tk2", title: "Linen-blend cami", store: "Amazon", price: 24, was: 24, color: "#E4DAC4", kind: "tank", tag: "tops", category: "tops", climate: "warm" },
  { id: "bl1", title: "Eyelet flutter-sleeve blouse", store: "Amazon", price: 38, was: 48, color: "#EDE8DE", kind: "blouse", tag: "tops", category: "tops", climate: "warm", popular: true },
  { id: "bl2", title: "Off-shoulder linen blouse", store: "Amazon", price: 42, was: 42, color: "#E9D98A", kind: "blouse", tag: "tops", category: "tops", climate: "warm" },
  { id: "bl3", title: "Gauze tie-front top", store: "Amazon", price: 32, was: 40, color: "#A9C3D6", kind: "blouse", tag: "tops", category: "tops", climate: "warm" },
  { id: "cr1", title: "Crochet knit halter top", store: "Amazon", price: 34, was: 34, color: "#E4DAC4", kind: "crochet-top", tag: "tops", category: "tops", climate: "warm", popular: true },
  { id: "cr2", title: "Open-knit crochet cami", store: "Amazon", price: 30, was: 38, color: "#EDE8DE", kind: "crochet-top", tag: "tops", category: "tops", climate: "warm" },
  // Knitwear (cool evenings / city layers)
  { id: "kn1", title: "Fine-knit crew sweater", store: "Amazon", price: 45, was: 45, color: "#A7B49E", kind: "sweater", tag: "knitwear", category: "knitwear", climate: "cool" },
  { id: "kn2", title: "Longline knit cardigan", store: "Amazon", price: 52, was: 68, color: "#E4DAC4", kind: "cardigan", tag: "knitwear", category: "knitwear", climate: "cool", popular: true },
  // Dresses — day
  { id: "sd1", title: "Tiered smocked mini sundress", store: "Amazon", price: 46, was: 58, color: "#C0392B", kind: "sundress", tag: "dresses", category: "dresses", climate: "warm", popular: true },
  { id: "sd2", title: "Gingham babydoll sundress", store: "Amazon", price: 42, was: 42, color: "#E8896B", kind: "sundress", tag: "dresses", category: "dresses", climate: "warm" },
  { id: "sd3", title: "Bell-sleeve cotton mini dress", store: "Amazon", price: 48, was: 48, color: "#EDE8DE", kind: "sundress", tag: "dresses", category: "dresses", climate: "warm" },
  { id: "mx1", title: "Halter-neck flowy maxi dress", store: "Amazon", price: 62, was: 78, color: "#EDE8DE", kind: "maxi-dress", tag: "dresses", category: "dresses", climate: "warm", popular: true },
  { id: "mx2", title: "One-shoulder linen maxi", store: "Amazon", price: 72, was: 72, color: "#E9D98A", kind: "maxi-dress", tag: "dresses", category: "dresses", climate: "warm" },
  { id: "mx3", title: "Embroidered white maxi dress", store: "Amazon", price: 88, was: 110, color: "#EDE8DE", kind: "maxi-dress", tag: "dresses", category: "dresses", climate: "warm" },
  // Dresses — evening / cruise
  { id: "sl1", title: "Satin bias slip dress", store: "Amazon", price: 54, was: 54, color: "#D9B8B0", kind: "slip-dress", tag: "dresses", category: "dresses", climate: "any", popular: true },
  { id: "sl2", title: "Midi slip dress", store: "Amazon", price: 48, was: 60, color: "#A7B49E", kind: "slip-dress", tag: "dresses", category: "dresses", climate: "any" },
  { id: "ck1", title: "Ruched cocktail midi dress", store: "Amazon", price: 68, was: 84, color: "#C0392B", kind: "cocktail-dress", tag: "dresses", category: "dresses", climate: "any", popular: true },
  { id: "ck2", title: "Cut-out jersey midi dress", store: "Amazon", price: 58, was: 58, color: "#2A2622", kind: "cocktail-dress", tag: "dresses", category: "dresses", climate: "any" },
  { id: "gw1", title: "Sequin slip gown", store: "Amazon", price: 118, was: 148, color: "#C9A227", kind: "gown", tag: "dresses", category: "dresses", climate: "any", popular: true },
  { id: "gw2", title: "Draped one-shoulder gown", store: "Amazon", price: 98, was: 98, color: "#2E3A52", kind: "gown", tag: "dresses", category: "dresses", climate: "any" },
  // One-piece outfits & sets
  { id: "rm1", title: "Linen tie-strap romper", store: "Amazon", price: 44, was: 52, color: "#E4DAC4", kind: "romper", tag: "dresses", category: "dresses", climate: "warm", popular: true },
  { id: "rm2", title: "Halter playsuit romper", store: "Amazon", price: 40, was: 40, color: "#E8896B", kind: "romper", tag: "dresses", category: "dresses", climate: "warm" },
  { id: "jp1", title: "Wide-leg palazzo jumpsuit", store: "Amazon", price: 64, was: 80, color: "#2A2622", kind: "jumpsuit", tag: "dresses", category: "dresses", climate: "any", popular: true },
  { id: "jp2", title: "Halter culotte jumpsuit", store: "Amazon", price: 58, was: 58, color: "#4FB0A5", kind: "jumpsuit", tag: "dresses", category: "dresses", climate: "any" },
  { id: "co1", title: "Linen top & shorts co-ord", store: "Amazon", price: 56, was: 70, color: "#E4DAC4", kind: "coord", tag: "dresses", category: "dresses", climate: "warm", popular: true },
  { id: "co2", title: "Crochet top & skirt set", store: "Amazon", price: 62, was: 62, color: "#EDE8DE", kind: "coord", tag: "dresses", category: "dresses", climate: "warm" },
  // Swimwear
  { id: "bk1", title: "Triangle string bikini set", store: "Amazon", price: 34, was: 44, color: "#C0392B", kind: "bikini", tag: "swimwear", category: "swimwear", climate: "water", popular: true },
  { id: "bk2", title: "High-waisted bikini set", store: "Amazon", price: 38, was: 38, color: "#A7B49E", kind: "bikini", tag: "swimwear", category: "swimwear", climate: "water" },
  { id: "bk3", title: "Bandeau bikini set", store: "Amazon", price: 36, was: 46, color: "#E9D98A", kind: "bikini", tag: "swimwear", category: "swimwear", climate: "water" },
  { id: "bk4", title: "Crochet triangle bikini", store: "Amazon", price: 42, was: 42, color: "#E4DAC4", kind: "bikini", tag: "swimwear", category: "swimwear", climate: "water" },
  { id: "op1", title: "Minimalist one-piece swimsuit", store: "Amazon", price: 46, was: 58, color: "#EDE8DE", kind: "one-piece", tag: "swimwear", category: "swimwear", climate: "water", popular: true },
  { id: "op2", title: "Cut-out one-piece swimsuit", store: "Amazon", price: 52, was: 52, color: "#2A2622", kind: "one-piece", tag: "swimwear", category: "swimwear", climate: "water" },
  { id: "op3", title: "Textured scoop-back maillot", store: "Amazon", price: 48, was: 60, color: "#E8896B", kind: "one-piece", tag: "swimwear", category: "swimwear", climate: "water" },
  { id: "cv1", title: "Crochet beach cover-up dress", store: "Amazon", price: 40, was: 52, color: "#E4DAC4", kind: "coverup", tag: "swimwear", category: "swimwear", climate: "water", popular: true },
  { id: "cv2", title: "Sheer chiffon sarong", store: "Amazon", price: 24, was: 24, color: "#EDE8DE", kind: "coverup", tag: "swimwear", category: "swimwear", climate: "water" },
  { id: "cv3", title: "Mesh cover-up maxi skirt", store: "Amazon", price: 32, was: 40, color: "#A9C3D6", kind: "coverup", tag: "swimwear", category: "swimwear", climate: "water" },
  { id: "kf1", title: "Embroidered kaftan", store: "Amazon", price: 58, was: 72, color: "#EDE8DE", kind: "kaftan", tag: "swimwear", category: "swimwear", climate: "warm", popular: true },
  { id: "kf2", title: "Printed silk-feel kaftan", store: "Amazon", price: 48, was: 48, color: "#4FB0A5", kind: "kaftan", tag: "swimwear", category: "swimwear", climate: "warm" },
  // Bottoms
  { id: "wp1", title: "Wide-leg linen trousers", store: "Amazon", price: 48, was: 60, color: "#E4DAC4", kind: "wide-leg-pants", tag: "bottoms", category: "bottoms", climate: "warm", popular: true },
  { id: "wp2", title: "Palazzo pull-on pants", store: "Amazon", price: 42, was: 42, color: "#2A2622", kind: "wide-leg-pants", tag: "bottoms", category: "bottoms", climate: "warm" },
  { id: "sh1", title: "High-rise linen shorts", store: "Amazon", price: 32, was: 32, color: "#E9D98A", kind: "shorts", tag: "bottoms", category: "bottoms", climate: "warm", popular: true },
  { id: "sh2", title: "Denim cut-off shorts", store: "Amazon", price: 36, was: 46, color: "#A9C3D6", kind: "shorts", tag: "bottoms", category: "bottoms", climate: "warm" },
  { id: "jn1", title: "High-rise straight-leg jeans", store: "Amazon", price: 52, was: 52, color: "#5B6B8C", kind: "jeans", tag: "bottoms", category: "bottoms", climate: "any", popular: true },
  { id: "jn2", title: "Wide-leg cropped jeans", store: "Amazon", price: 56, was: 70, color: "#2E3A52", kind: "jeans", tag: "bottoms", category: "bottoms", climate: "any" },
  { id: "sk1", title: "Flowy midi skirt", store: "Amazon", price: 40, was: 40, color: "#E8896B", kind: "skirt", tag: "bottoms", category: "bottoms", climate: "warm", popular: true },
  { id: "sk2", title: "Linen wrap maxi skirt", store: "Amazon", price: 46, was: 58, color: "#E4DAC4", kind: "skirt", tag: "bottoms", category: "bottoms", climate: "warm" },
  { id: "sk3", title: "Sequin midi skirt", store: "Amazon", price: 54, was: 54, color: "#C9A227", kind: "skirt", tag: "bottoms", category: "bottoms", climate: "any" },
  // Outerwear / layers
  { id: "bz1", title: "Relaxed linen blazer", store: "Amazon", price: 72, was: 90, color: "#E4DAC4", kind: "blazer", tag: "outerwear", category: "outerwear", climate: "any", popular: true },
  { id: "bz2", title: "Cropped tailored blazer", store: "Amazon", price: 68, was: 68, color: "#2E3A52", kind: "blazer", tag: "outerwear", category: "outerwear", climate: "any" },
  { id: "dj1", title: "Classic cropped denim jacket", store: "Amazon", price: 54, was: 68, color: "#5B6B8C", kind: "denim-jacket", tag: "outerwear", category: "outerwear", climate: "any", popular: true },
  { id: "ct1", title: "Lightweight trench coat", store: "Amazon", price: 88, was: 110, color: "#C7A87A", kind: "coat", tag: "outerwear", category: "outerwear", climate: "cool" },
  { id: "rn1", title: "Packable rain jacket", store: "Amazon", price: 48, was: 48, color: "#A7B49E", kind: "rain-jacket", tag: "outerwear", category: "outerwear", climate: "rain", popular: true },
  // Shoes
  { id: "sn1", title: "Clean leather low-top sneakers", store: "Amazon", price: 62, was: 78, color: "#EDE8DE", kind: "sneakers", tag: "shoes", category: "shoes", climate: "any", popular: true },
  { id: "sa1", title: "Strappy flat sandals", store: "Amazon", price: 34, was: 44, color: "#C7A87A", kind: "sandals", tag: "shoes", category: "shoes", climate: "warm", popular: true },
  { id: "sa2", title: "Square-toe slide sandals", store: "Amazon", price: 38, was: 38, color: "#6B4B34", kind: "sandals", tag: "shoes", category: "shoes", climate: "warm" },
  { id: "es1", title: "Espadrille wedge sandals", store: "Amazon", price: 52, was: 66, color: "#C7A87A", kind: "espadrilles", tag: "shoes", category: "shoes", climate: "warm", popular: true },
  { id: "es2", title: "Flat lace-up espadrilles", store: "Amazon", price: 42, was: 42, color: "#E4DAC4", kind: "espadrilles", tag: "shoes", category: "shoes", climate: "warm" },
  { id: "hs1", title: "Strappy block-heel sandals", store: "Amazon", price: 58, was: 72, color: "#C9A227", kind: "heeled-sandals", tag: "shoes", category: "shoes", climate: "any", popular: true },
  { id: "hs2", title: "Barely-there stiletto sandals", store: "Amazon", price: 62, was: 62, color: "#2A2622", kind: "heeled-sandals", tag: "shoes", category: "shoes", climate: "any" },
  // Bags
  { id: "st1", title: "Oversized raffia straw tote", store: "Amazon", price: 44, was: 56, color: "#E4DAC4", kind: "straw-tote", tag: "bags", category: "bags", climate: "warm", popular: true },
  { id: "st2", title: "Woven crochet beach bag", store: "Amazon", price: 38, was: 38, color: "#EDE8DE", kind: "straw-tote", tag: "bags", category: "bags", climate: "warm" },
  { id: "cb1", title: "Leather crossbody bag", store: "Amazon", price: 58, was: 74, color: "#6B4B34", kind: "crossbody", tag: "bags", category: "bags", climate: "any", popular: true },
  { id: "cb2", title: "Quilted chain crossbody", store: "Amazon", price: 64, was: 64, color: "#2A2622", kind: "crossbody", tag: "bags", category: "bags", climate: "any" },
  { id: "cl1", title: "Embellished evening clutch", store: "Amazon", price: 42, was: 54, color: "#C9A227", kind: "clutch", tag: "bags", category: "bags", climate: "any", popular: true },
  { id: "cl2", title: "Satin envelope clutch", store: "Amazon", price: 34, was: 34, color: "#D9B8B0", kind: "clutch", tag: "bags", category: "bags", climate: "any" },
  // Accessories
  { id: "sg1", title: "Oversized square sunglasses", store: "Amazon", price: 26, was: 34, color: "#2A2622", kind: "sunglasses", tag: "accessories", category: "accessories", climate: "warm", popular: true },
  { id: "sg2", title: "Cat-eye acetate sunglasses", store: "Amazon", price: 28, was: 28, color: "#6B4B34", kind: "sunglasses", tag: "accessories", category: "accessories", climate: "warm" },
  { id: "hat1", title: "Wide-brim straw sun hat", store: "Amazon", price: 34, was: 44, color: "#C79A44", kind: "sun-hat", tag: "accessories", category: "accessories", climate: "warm", popular: true },
  { id: "hat2", title: "Packable panama hat", store: "Amazon", price: 30, was: 30, color: "#E4DAC4", kind: "sun-hat", tag: "accessories", category: "accessories", climate: "warm" },
  { id: "scf1", title: "Silk hair scarf", store: "Amazon", price: 18, was: 24, color: "#E8896B", kind: "scarf", tag: "accessories", category: "accessories", climate: "any", popular: true },
  { id: "scf2", title: "Lightweight woven scarf", store: "Amazon", price: 24, was: 24, color: "#A9C3D6", kind: "scarf", tag: "accessories", category: "accessories", climate: "cool" },
  { id: "er1", title: "Statement drop earrings", store: "Amazon", price: 22, was: 28, color: "#C9A227", kind: "earrings", tag: "accessories", category: "accessories", climate: "any", popular: true },
  { id: "er2", title: "Shell hoop earrings", store: "Amazon", price: 18, was: 18, color: "#EDE8DE", kind: "earrings", tag: "accessories", category: "accessories", climate: "warm" },
];

// Amazon Associates tracking tag. Appended to every Amazon URL (product or
// search) so qualifying purchases earn commission — without this tag, Amazon
// clicks pay nothing. Set once here; never scatter it across the codebase.
const AMAZON_TAG = "feellikeyou-20";

// Ensure any Amazon URL carries our Associates tag. Non-Amazon URLs pass
// through untouched. Works for both product links and search links.
function withAmazonTag(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)amazon\.[a-z.]+$/i.test(u.hostname)) return url;
    u.searchParams.set("tag", AMAZON_TAG);
    return u.toString();
  } catch {
    return url;
  }
}

// Every product card needs somewhere to click. Live feed products carry a
// tracked affiliate deep link in `sourceUrl` — that's the one that actually
// earns commission, so it always wins. Next, an explicit Amazon product link
// earns once it carries our tag. Failing both, we fall back to a *tagged*
// Amazon search: unlike the old Google Shopping link (which earned nothing),
// this still earns commission on anything bought in that session while keeping
// the card from being a dead end. `tracked` tells the UI whether to present the
// link as a direct product ("View" + rel=sponsored) vs. a search ("Find it").
function buyLinkFor(item) {
  if (item && item.sourceUrl) return { url: item.sourceUrl, tracked: true };
  if (item && item.amazonUrl) return { url: withAmazonTag(item.amazonUrl), tracked: true };
  // Boutique store names (COS, Toast) aren't on Amazon, so search the generic
  // title/category for relevant results rather than the boutique brand.
  const query = encodeURIComponent(item?.title || item?.category || "");
  return { url: withAmazonTag(`https://www.amazon.com/s?k=${query}`), tracked: false };
}

/* ---------------------------------------------------
   PLACES + WEATHER API
   Both go through our own proxy so the Geoapify key stays server-side.
--------------------------------------------------- */

const API_BASE = "https://image-proxy-rosy.vercel.app/api";

async function searchPlaces(q, type = "city", bias = []) {
  if (!q || q.trim().length < 2) return [];
  const biasParam = bias.length > 0 ? `&bias=${bias.join(",")}` : "";
  const r = await fetch(`${API_BASE}/places?q=${encodeURIComponent(q.trim())}&type=${type}${biasParam}`);
  if (!r.ok) throw new Error(`places ${r.status}`);
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return Array.isArray(data) ? data : [];
}

async function fetchWeather(lat, lon, start, end) {
  const r = await fetch(`${API_BASE}/weather?lat=${lat}&lon=${lon}&start=${start}&end=${end}`);
  if (!r.ok) throw new Error(`weather ${r.status}`);
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data; // { source: 'forecast'|'seasonal', days: [{date,hi,lo,icon}] }
}

// Real affiliate products. The feed proxy keeps the Awin key server-side and
// returns products already normalised to the app's shape.
async function fetchFeedProducts() {
  const r = await fetch(`${API_BASE}/feed`);
  if (!r.ok) throw new Error(`feed ${r.status}`);
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return (data.products || []).map((p) => {
    // Fold the merchant's category wording into the app taxonomy so feed
    // products filter and match alongside everything else.
    const cat = normalizeCategory(p.category);
    return {
      ...p,
      category: cat,
      // Feed colour names are free text ("olive green"); resolve to a hex the
      // matching engine can score against, neutral grey when unknown.
      color: resolveColour(p.colorName || ""),
      tag: cat,
      // Feed products carry no weather signal from the merchant, so scan the
      // title and description for it. Without this every live product would
      // default to "any" and show up on every trip regardless of forecast.
      climate: inferClimate(p.title || p.product_name || p.name, p.description, cat),
    };
  });
}

// --- date helpers ---
function toISO(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}
function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);
}
function prettyDate(iso) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// Demo trip — real coordinates so it pulls live weather, dates set a few weeks
// out so it lands inside the forecast window rather than seasonal averages.
const DEMO_START = addDays(toISO(new Date()), 10);
const DEMO_END = addDays(DEMO_START, 14);

const STARTER_COUNTRIES = [
  { id: "c-it", name: "Italy", label: "Italy", countryCode: "it", lat: 42.6384261, lon: 12.674297, nights: 15 },
];

const STARTER_LEGS = [
  { id: "rome1", city: "Rome", label: "Rome, Italy", country: "Italy", lat: 41.8933203, lon: 12.4829321, nights: 3, coastal: false },
  { id: "florence", city: "Florence", label: "Florence, Italy", country: "Italy", lat: 43.7698712, lon: 11.2555757, nights: 2, coastal: false },
  { id: "sorrento", city: "Sorrento", label: "Sorrento, Italy", country: "Italy", lat: 40.6263237, lon: 14.3757922, nights: 5, coastal: true },
  { id: "positano", city: "Positano", label: "Positano, Italy", country: "Italy", lat: 40.6280928, lon: 14.4849778, nights: 4, coastal: true },
];

// Splits trip days across countries as evenly as possible, giving the remainder
// to the earlier ones. Used as the default until the user adjusts it.
function evenSplit(total, count) {
  if (count === 0) return [];
  const base = Math.floor(total / count);
  const extra = total % count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

// Candidate packing catalogue. This is deliberately broad — recommendFor()
// hides anything the weather/geography doesn't call for, so the *visible* list
// stays tight and specific to each trip (a hot beach week and a cold city break
// surface almost entirely different items from the same source list).
//
// Gating fields (all optional; any that are set must pass):
//   warmMin  show only if the daytime high reaches this (°C)
//   coolMax  show only if the nightly low drops to this or below (°C)
//   rain     show only if rain is forecast
//   sun      show only if it's sunny OR hot (UV matters even under cloud)
//   coastal  show only if the trip has coastal days
// Quantity fields: perDays / qtyMin / qtyMax / spare (one extra).
// why: picks a live, weather-driven subtitle ("warm days up to 32°C").
// climate: steers which shop products match this item.
const STARTER_SUGGESTED = [
  // Warm-weather clothing. `kind` is the fine-grained type the shop picker
  // matches on (category alone lumps sunglasses, hats and belts together).
  { id: "s1", label: "Tops & tanks", reason: "everyday warm-weather basics", packed: false, category: "tops", kind: "tank", climate: "warm", warmMin: 22, perDays: 2, qtyMin: 3, qtyMax: 9, why: "warm" },
  { id: "s2", label: "Blouses & linen shirts", reason: "breathable for the heat", packed: false, category: "tops", kind: "blouse", climate: "warm", warmMin: 23, perDays: 2, qtyMin: 2, qtyMax: 6 },
  { id: "s3", label: "Shorts", reason: "hot daytime highs", packed: false, category: "bottoms", kind: "shorts", climate: "warm", warmMin: 23, perDays: 3, qtyMin: 2, qtyMax: 5 },
  { id: "s4", label: "Sundresses", reason: "easy warm-weather outfits", packed: false, category: "dresses", kind: "sundress", climate: "warm", warmMin: 24, perDays: 3, qtyMin: 1, qtyMax: 4 },
  { id: "s24", label: "Maxi dress", reason: "day-to-dinner in the heat", packed: false, category: "dresses", kind: "maxi-dress", climate: "warm", warmMin: 24, perDays: 5, qtyMin: 1, qtyMax: 2 },
  { id: "s5", label: "Sandals", reason: "warm-weather footwear", packed: false, category: "shoes", kind: "sandals", climate: "warm", warmMin: 23 },
  // Cool / cold clothing
  { id: "s6", label: "Knit sweaters", reason: "for the cold", packed: false, category: "knitwear", kind: "sweater", climate: "cool", coolMax: 13, perDays: 4, qtyMin: 1, qtyMax: 3, why: "cool" },
  { id: "s7", label: "Warm coat", reason: "cold days and nights", packed: false, category: "outerwear", kind: "coat", climate: "cool", coolMax: 6 },
  { id: "s8", label: "Evening layer", reason: "cooler evenings", packed: false, category: "knitwear", kind: "cardigan", climate: "cool", coolMax: 17, perDays: 5, qtyMin: 1, qtyMax: 2, why: "cool" },
  { id: "s9", label: "Light scarf", reason: "cooler mornings", packed: false, category: "accessories", kind: "scarf", climate: "cool", coolMax: 12, why: "cool" },
  // Rain
  { id: "s10", label: "Light rain jacket", reason: "in case of rain", packed: false, category: "outerwear", kind: "rain-jacket", climate: "rain", rain: true, why: "rain" },
  { id: "s11", label: "Compact umbrella", reason: "in case of rain", packed: false, category: null, rain: true, why: "rain" },
  // Sun / UV
  { id: "s12", label: "Sunglasses", reason: "glare and UV protection", packed: false, category: "accessories", kind: "sunglasses", climate: "warm", sun: true },
  { id: "s13", label: "Sun hat", reason: "shade for your face in the heat", packed: false, category: "accessories", kind: "sun-hat", climate: "warm", sun: true, warmMin: 20 },
  { id: "s14", label: "Sunscreen SPF 50", reason: "strong UV — reapply near water", packed: false, category: null, sun: true, warmMin: 18 },
  // Coastal / beach
  { id: "s15", label: "Swimwear", reason: "for beach and pool days", packed: false, category: "swimwear", kind: "bikini", climate: "water", coastal: true, warmMin: 20, perDays: 3, qtyMin: 2, qtyMax: 4, why: "coastal" },
  { id: "s25", label: "Beach cover-up", reason: "beach-to-bar throw-on", packed: false, category: "swimwear", kind: "coverup", climate: "water", coastal: true, warmMin: 22, perDays: 5, qtyMin: 1, qtyMax: 2, why: "coastal" },
  { id: "s16", label: "Quick-dry beach towel", reason: "for beach and pool days", packed: false, category: null, coastal: true },
  { id: "s17", label: "Flip-flops / water shoes", reason: "sand, pool decks, wet surfaces", packed: false, category: "shoes", kind: "sandals", climate: "warm", coastal: true },
  // Tropical extras
  { id: "s18", label: "Insect repellent", reason: "mosquitoes near the coast and after rain", packed: false, category: null, warmMin: 24 },
  // Everyday essentials (always relevant)
  { id: "s19", label: "Comfortable walking shoes", reason: "daily walking and sightseeing", packed: false, category: "shoes", kind: "sneakers", climate: "any" },
  { id: "s20", label: "Day bag", reason: "daily essentials on the go", packed: false, category: "bags", kind: "crossbody", climate: "any" },
  { id: "s21", label: "Pairs of socks", reason: "one per day plus a spare", packed: false, category: null, perDays: 1, qtyMin: 3, qtyMax: 16, spare: true },
  { id: "s22", label: "Underwear", reason: "one per day plus a spare", packed: false, category: null, perDays: 1, qtyMin: 3, qtyMax: 16, spare: true },
  { id: "s23", label: "Sleepwear", reason: "comfortable for the room", packed: false, category: null, perDays: 4, qtyMin: 1, qtyMax: 3 },
];

/* ---------------------------------------------------
   "EVERYTHING ELSE" — non-clothing travel essentials.
   A grouped, mostly-static catalog that sits behind a collapsed dropdown so it
   never competes with the core clothing packing list. Items can be:
     • checklist-only (documents, medication) — nothing sensible to sell, so no
       Shop button; or
     • shoppable (gear & consumables) — `shop: true` + a generic `search` term we
       turn into a tagged Amazon search so a purchase can earn commission.
   Gating fields mirror the clothing list (warmMin / coolMax / rain / coastal)
   plus `longMin` (trips of at least N days) so extras only appear when the
   destination and dates actually call for them. These items are deliberately
   kept OUT of Discover and Watch — they live only here on the trip planner.
--------------------------------------------------- */

// Adapter recommendation by destination. Rather than a 200-row plug table, we
// bucket destinations into the handful of adapter "families" a traveller
// actually shops for. A European (Type C) adapter physically fits the recessed
// Swiss/Italian/Danish/Nordic sockets too, so those all fold into `eu`.
const PLUG_REGIONS = {
  eu: { types: "C/E/F", label: "European", search: "european travel plug adapter type c" },
  uk: { types: "G", label: "UK-style", search: "uk travel plug adapter type g" },
  us: { types: "A/B", label: "US / Japan-style", search: "us travel plug adapter type a b" },
  au: { types: "I", label: "Australian", search: "australia travel plug adapter type i" },
};

// ISO alpha-2 country code (lowercase, as Geoapify returns) → adapter family.
// Anything not listed falls back to a universal adapter, which is always safe.
const PLUG_CC = {
  // Continental Europe + Type C/E/F world (Type C fits CH/IT/DK/Nordic sockets)
  al: "eu", ad: "eu", at: "eu", ba: "eu", be: "eu", bg: "eu", hr: "eu", cz: "eu",
  dk: "eu", ee: "eu", fi: "eu", fr: "eu", de: "eu", gr: "eu", hu: "eu", is: "eu",
  it: "eu", xk: "eu", lv: "eu", li: "eu", lt: "eu", lu: "eu", mc: "eu", me: "eu",
  nl: "eu", no: "eu", pl: "eu", pt: "eu", ro: "eu", rs: "eu", sk: "eu", si: "eu",
  es: "eu", se: "eu", ch: "eu", ua: "eu", tr: "eu", by: "eu", ru: "eu", md: "eu",
  mk: "eu", va: "eu", sm: "eu", id: "eu", ma: "eu", tn: "eu", dz: "eu", eg: "eu",
  // Type G
  gb: "uk", ie: "uk", mt: "uk", cy: "uk", gi: "uk", im: "uk", je: "uk", gg: "uk",
  ae: "uk", qa: "uk", om: "uk", kw: "uk", bh: "uk", sa: "uk", sg: "uk", hk: "uk",
  mo: "uk", my: "uk", mv: "uk", lk: "uk", ke: "uk", tz: "uk", ug: "uk", ng: "uk",
  gh: "uk", bn: "uk",
  // Type A/B (North & Central America, Caribbean, Japan, etc.)
  us: "us", ca: "us", mx: "us", gt: "us", bz: "us", sv: "us", hn: "us", ni: "us",
  cr: "us", pa: "us", co: "us", ec: "us", ve: "us", pe: "us", jp: "us", tw: "us",
  bs: "us", do: "us", cu: "us", jm: "us", ky: "us", tc: "us", pr: "us", vi: "us",
  ht: "us", aw: "us", bb: "us", ph: "us", cn: "us",
  // Type I
  au: "au", nz: "au", fj: "au", ck: "au", ws: "au", to: "au", pg: "au", ar: "au",
};

// Builds the adapter checklist row for a trip, from the countries on it.
// One known plug family → a specific adapter; none, mixed, or any unknown
// destination → a universal adapter (never steer someone wrong).
function adapterEssentialFor(countries) {
  const codes = (countries || []).map((c) => (c.countryCode || "").toLowerCase()).filter(Boolean);
  const universal = {
    label: "Universal travel adapter",
    search: "universal travel adapter worldwide all in one usb",
    note: codes.length ? "covers the plug types on this trip" : "add your destination for the exact plug type",
  };
  if (codes.length === 0) return universal;
  if (codes.some((cc) => !PLUG_CC[cc])) return universal; // an unmapped destination — play it safe
  const regions = [...new Set(codes.map((cc) => PLUG_CC[cc]))];
  if (regions.length !== 1) return universal; // spans multiple plug families
  const r = PLUG_REGIONS[regions[0]];
  return {
    label: `${r.label} power adapter (Type ${r.types})`,
    search: `${r.search} usb`,
    note: "matches the outlets at your destination",
  };
}

// Whether an essential is relevant to this trip's forecast, coast and length.
// Ungated items always show; weather-gated ones stay hidden until the forecast
// loads so we never surface sunscreen and hand cream at the same time.
function essentialShows(item, conditions, coastalDays, tripDays) {
  if (item.longMin != null && tripDays < item.longMin) return false;
  if (item.coastal && coastalDays === 0) return false;
  if (!conditions) return item.warmMin == null && item.coolMax == null && !item.rain;
  if (item.warmMin != null && conditions.maxHi < item.warmMin) return false;
  if (item.coolMax != null && conditions.minLo > item.coolMax) return false;
  if (item.rain && conditions.rainDays === 0) return false;
  return true;
}

// Group order + display labels for the dropdown.
const ESSENTIAL_GROUP_META = [
  { id: "documents", label: "Documents & money" },
  { id: "tech", label: "Tech & power" },
  { id: "health", label: "Health & toiletries" },
  { id: "comfort", label: "Comfort & flight" },
  { id: "organization", label: "Bags & organization" },
];

const STARTER_OTHER = [
  // Documents & money — checklist only (nothing to sensibly shop)
  { id: "e-passport", group: "documents", label: "Passport & travel documents", packed: false, shop: false },
  { id: "e-tickets", group: "documents", label: "Boarding passes & tickets", packed: false, shop: false },
  { id: "e-insurance", group: "documents", label: "Travel insurance details", packed: false, shop: false },
  { id: "e-money", group: "documents", label: "Cards & a little local cash", packed: false, shop: false },
  { id: "e-copies", group: "documents", label: "Backup copies of key documents", packed: false, shop: false, note: "a photo or printout, kept separately" },
  { id: "e-wallet", group: "documents", label: "RFID passport wallet", packed: false, shop: true, search: "rfid travel passport wallet organizer" },
  // Tech & power
  { id: "e-phone", group: "tech", label: "Phone & charger", packed: false, shop: false },
  { id: "e-adapter", group: "tech", label: "Travel power adapter", packed: false, shop: true, adapter: true },
  { id: "e-powerbank", group: "tech", label: "Portable power bank", packed: false, shop: true, search: "portable power bank travel usb c" },
  { id: "e-cables", group: "tech", label: "Charging cables", packed: false, shop: true, search: "usb c charging cable 2 pack" },
  { id: "e-earbuds", group: "tech", label: "Headphones or earbuds", packed: false, shop: true, search: "wireless bluetooth earbuds travel" },
  // Health & toiletries
  { id: "e-toiletries", group: "health", label: "Toiletries bag", packed: false, shop: true, search: "hanging travel toiletry bag women" },
  { id: "e-medication", group: "health", label: "Medication & prescriptions", packed: false, shop: false, note: "in original packaging; check destination rules" },
  { id: "e-firstaid", group: "health", label: "Mini first-aid kit", packed: false, shop: true, search: "compact travel first aid kit" },
  { id: "e-sanitizer", group: "health", label: "Hand sanitizer & wipes", packed: false, shop: true, search: "travel hand sanitizer and wipes" },
  { id: "e-sunscreen", group: "health", label: "Sunscreen SPF 50", packed: false, shop: true, search: "travel size sunscreen spf 50", warmMin: 20 },
  { id: "e-aftersun", group: "health", label: "After-sun / aloe gel", packed: false, shop: true, search: "aloe vera after sun gel", warmMin: 25 },
  { id: "e-repellent", group: "health", label: "Insect repellent", packed: false, shop: true, search: "travel insect repellent", warmMin: 24 },
  { id: "e-lips", group: "health", label: "Lip balm & hand cream", packed: false, shop: true, search: "lip balm and hand cream travel", coolMax: 8 },
  { id: "e-motion", group: "health", label: "Motion-sickness remedy", packed: false, shop: true, search: "motion sickness relief bands tablets", coastal: true, note: "handy for boats, ferries & cruises" },
  // Comfort & flight
  { id: "e-pillow", group: "comfort", label: "Neck pillow", packed: false, shop: true, search: "memory foam travel neck pillow" },
  { id: "e-eyemask", group: "comfort", label: "Eye mask & earplugs", packed: false, shop: true, search: "travel eye mask and earplugs set" },
  { id: "e-bottle", group: "comfort", label: "Reusable water bottle", packed: false, shop: true, search: "collapsible reusable water bottle travel" },
  { id: "e-snacks", group: "comfort", label: "Snacks for the journey", packed: false, shop: false },
  // Bags & organization
  { id: "e-cubes", group: "organization", label: "Packing cubes", packed: false, shop: true, search: "packing cubes set for suitcase" },
  { id: "e-laundry", group: "organization", label: "Laundry / shoe bag", packed: false, shop: true, search: "travel laundry bag drawstring" },
  { id: "e-daybag", group: "organization", label: "Foldable day bag", packed: false, shop: true, search: "packable foldable tote day bag" },
  { id: "e-detergent", group: "organization", label: "Laundry detergent sheets", packed: false, shop: true, search: "travel laundry detergent sheets", longMin: 8 },
  { id: "e-umbrella", group: "organization", label: "Compact umbrella", packed: false, shop: true, search: "compact windproof travel umbrella", rain: true },
  { id: "e-drybag", group: "organization", label: "Waterproof phone pouch", packed: false, shop: true, search: "waterproof phone pouch dry bag", coastal: true },
];

const STARTER_TRACKED = [
  { id: 1, title: "Brushed wool overshirt", store: "Toast", history: [195, 195, 189, 175, 175, 132], tag: "outerwear", droppedAt: "2 hours ago", threshold: 150 },
  { id: 2, title: "Suede desert boot", store: "Clarks", history: [145, 145, 140, 130, 130, 130], tag: "footwear", droppedAt: "yesterday", threshold: 140 },
  { id: 3, title: "Waffle-knit crewneck", store: "Arket", history: [72, 72, 72, 68, 68, 68], tag: "knitwear", droppedAt: null, threshold: 55 },
];

const TRIPS_LIBRARY = [
  { id: "t1", author: "Marta O.", title: "Italy, autumn", duration: "15 days", dates: "Sep 28 – Oct 12", cities: ["Rome", "Florence", "Sorrento", "Positano"], cover: ["#C4A5A0", "#8C6A5B"], palette: ["#3E4A3D", "#8C6A5B", "#C4A5A0", "#5B6B8C", "#A8785B"], likes: 428, itemCount: 22, tagged: true },
  { id: "t2", author: "Jonas B.", title: "Kyoto in bloom", duration: "8 days", dates: "Apr 2 – Apr 10", cities: ["Kyoto", "Nara"], cover: ["#C79A44", "#A8785B"], palette: ["#C79A44", "#3E4A3D", "#211D18", "#C4A5A0"], likes: 891, itemCount: 16, tagged: true },
  { id: "t3", author: "Priya S.", title: "Lisbon, slow week", duration: "7 days", dates: "Jun 14 – Jun 21", cities: ["Lisbon"], cover: ["#5B6B8C", "#C4A5A0"], palette: ["#5B6B8C", "#C4A5A0", "#C79A44"], likes: 213, itemCount: 12, tagged: false },
  { id: "t4", author: "Tomás R.", title: "Patagonia trek", duration: "13 days", dates: "Nov 3 – Nov 16", cities: ["Puerto Natales", "Torres del Paine", "El Chaltén"], cover: ["#3E4A3D", "#211D18"], palette: ["#3E4A3D", "#211D18", "#8C6A5B", "#5B6B8C"], likes: 1042, itemCount: 27, tagged: true },
];

const TRIP_LUGGAGE = [
  { id: "l1", label: "Brushed wool overshirt", tagged: true, store: "Toast", price: 175, color: "#5B6B8C", category: "outerwear" },
  { id: "l2", label: "Waffle-knit crewneck", tagged: true, store: "Arket", price: 68, color: "#C4A5A0", category: "knitwear" },
  { id: "l5", label: "Vintage silk scarf", tagged: false, color: "#C79A44", category: "accessories" },
  { id: "l7", label: "Woven leather belt", tagged: false, color: "#8C6A5B", category: "accessories" },
  { id: "l8", label: "Linen button-down", tagged: false, color: "#A8785B", category: "tops" },
];

const ICONS = { sun: Sun, cloud: Cloud, rain: CloudRain, partly: CloudSun };

/* ---------------------------------------------------
   SHARED SUBCOMPONENTS
--------------------------------------------------- */

function WeatherIcon({ icon, size = 16, color = "#211D18" }) {
  const Cmp = ICONS[icon] || Cloud;
  return <Cmp size={size} color={color} />;
}

function RouteStrip({ cities, w = 100 }) {
  const pad = 8;
  const n = cities.length;
  const step = n > 1 ? (w - pad * 2) / (n - 1) : 0;
  return (
    <svg width={w} height={14} style={{ overflow: "visible" }}>
      {n > 1 && <line x1={pad} y1={7} x2={w - pad} y2={7} stroke="#D8D0C0" strokeWidth="1.2" />}
      {cities.map((c, i) => (
        <circle key={c} cx={pad + step * i} cy={7} r={i === 0 || i === n - 1 ? 3.2 : 2.4} fill="#211D18" />
      ))}
    </svg>
  );
}

// The kinds we ship a local placeholder photo for. Drop a square image at
// public/products/<kind>.jpg (e.g. public/products/sunglasses.jpg) and it shows
// for every item of that kind that doesn't yet have a real feed photo. Keeping
// this as an explicit set means we never request a file we know won't exist
// (avoids console 404s); anything not listed simply falls back to the swatch.
const PRODUCT_IMAGE_KINDS = new Set([
  // Tops & knitwear
  "tank", "blouse", "crochet-top", "sweater", "cardigan",
  // Dresses & one-piece outfits
  "sundress", "maxi-dress", "slip-dress", "cocktail-dress", "gown",
  "romper", "jumpsuit", "coord",
  // Swim & beach
  "bikini", "one-piece", "coverup", "kaftan",
  // Bottoms
  "wide-leg-pants", "shorts", "jeans", "skirt",
  // Outerwear
  "blazer", "denim-jacket", "coat", "rain-jacket",
  // Shoes
  "sandals", "espadrilles", "heeled-sandals", "sneakers",
  // Bags
  "straw-tote", "crossbody", "clutch",
  // Accessories
  "sunglasses", "sun-hat", "scarf", "earrings",
]);

// Path to the local placeholder photo for a kind, or "" if we don't ship one.
function kindImage(kind) {
  return kind && PRODUCT_IMAGE_KINDS.has(kind) ? `/products/${kind}.jpg` : "";
}

// Interim line-art icons, one per kind, drawn inline as SVG (no files to host,
// crisp at any size). Shown only when no photo is available yet — i.e. the feed
// hasn't supplied one and no local /products/<kind>.jpg has been added. The
// moment a real photo exists for a kind, ProductVisual prefers it and the icon
// steps aside, so this is a temporary layer, not something to remove later.
// Each value is the inner artwork; KindIcon wraps it in a sized, tinted frame.
const KIND_ICON_ART = {
  // Tops & knitwear
  tank: (<><path d="M20 15 L20 37 L28 37 L28 15" /><path d="M20 15 L21 11" /><path d="M28 15 L27 11" /><path d="M21 12 Q24 15 27 12" /></>),
  blouse: (<><path d="M18 12 L18 37 L30 37 L30 12" /><polyline points="18,12 24,17 30,12" /><line x1="24" y1="17" x2="24" y2="37" /></>),
  "crochet-top": (<><path d="M18 16 L30 16 L29 29 L19 29 Z" /><line x1="20" y1="16" x2="21" y2="11" /><line x1="28" y1="16" x2="27" y2="11" /><line x1="18" y1="20" x2="30" y2="23" /><line x1="18" y1="24" x2="30" y2="27" /><line x1="22" y1="16" x2="20" y2="29" /><line x1="27" y1="16" x2="28" y2="29" /></>),
  sweater: (<path d="M17 13 L14 16 L17 19 L17 37 L31 37 L31 19 L34 16 L31 13 L27 13 Q24 16 21 13 Z" />),
  cardigan: (<><path d="M23 13 L17 13 L14 16 L17 19 L17 37 L23 37" /><path d="M25 13 L31 13 L34 16 L31 19 L31 37 L25 37" /><line x1="24" y1="14" x2="24" y2="37" /><circle cx="24" cy="22" r="1" /><circle cx="24" cy="29" r="1" /></>),
  // Dresses & one-piece outfits
  sundress: (<><path d="M20 12 L28 12 L30 20 L32 32 L16 32 L18 20 Z" /><polyline points="21,12 24,15 27,12" /></>),
  "maxi-dress": (<><path d="M20 12 L28 12 L27 20 L31 40 L17 40 L21 20 Z" /><polyline points="21,12 24,15 27,12" /></>),
  "slip-dress": (<><path d="M20 13 L28 13 L27 22 L29 38 L19 38 L21 22 Z" /><line x1="20" y1="13" x2="21" y2="10" /><line x1="28" y1="13" x2="27" y2="10" /></>),
  "cocktail-dress": (<><path d="M19 13 L29 13 L28 23 L20 23 Z" /><path d="M20 23 L28 23 L31 36 L17 36 Z" /><line x1="19" y1="13" x2="21" y2="16" /><line x1="29" y1="13" x2="27" y2="16" /></>),
  gown: (<><path d="M19 14 Q24 17 29 14 L28 26 L32 41 L16 41 L20 26 Z" /><line x1="19" y1="14" x2="20" y2="11" /><line x1="29" y1="14" x2="28" y2="11" /></>),
  romper: (<><path d="M19 14 L29 14 L29 25 L25 25 L25 31 L23 31 L23 25 L19 25 Z" /><line x1="21" y1="14" x2="22" y2="11" /><line x1="27" y1="14" x2="26" y2="11" /></>),
  jumpsuit: (<><path d="M21 12 L27 12 L28 23 L20 23 Z" /><path d="M20 23 L28 23 L30 37 L25 37 L24 27 L23 37 L18 37 Z" /><line x1="24" y1="12" x2="24" y2="9" /></>),
  coord: (<><path d="M19 12 L29 12 L29 20 L19 20 Z" /><line x1="21" y1="12" x2="22" y2="10" /><line x1="27" y1="12" x2="26" y2="10" /><path d="M20 24 L28 24 L30 34 L18 34 Z" /></>),
  // Swim & beach
  bikini: (<><path d="M15 19 L21 19 L18 25 Z" /><path d="M27 19 L33 19 L30 25 Z" /><line x1="21" y1="20" x2="27" y2="20" /><line x1="15" y1="19" x2="13" y2="17" /><line x1="33" y1="19" x2="35" y2="17" /><path d="M19 30 L29 30 L26 36 L24 34 L22 36 Z" /></>),
  "one-piece": (<><path d="M18 14 L30 14 L29 24 Q27 30 24 31 Q21 30 19 24 Z" /><path d="M22 30 Q24 27 26 30" /><line x1="19" y1="14" x2="20" y2="11" /><line x1="29" y1="14" x2="28" y2="11" /></>),
  coverup: (<><path d="M16 14 L32 14 L34 37 L14 37 Z" /><line x1="24" y1="14" x2="24" y2="37" /><line x1="20" y1="16" x2="20" y2="35" /><line x1="28" y1="16" x2="28" y2="35" /></>),
  kaftan: (<><path d="M10 18 L18 15 L30 15 L38 18 L34 22 L31 20 L32 38 L16 38 L17 20 L14 22 Z" /><line x1="24" y1="15" x2="24" y2="20" /><line x1="20" y1="24" x2="28" y2="24" /></>),
  // Bottoms
  "wide-leg-pants": (<><path d="M17 12 L31 12 L33 37 L25 37 L24 20 L23 37 L15 37 Z" /><line x1="17" y1="16" x2="31" y2="16" /></>),
  shorts: (<><path d="M17 14 L31 14 L31 30 L26 30 L26 20 L22 20 L22 30 L17 30 Z" /><line x1="17" y1="18" x2="31" y2="18" /></>),
  jeans: (<><path d="M17 12 L31 12 L31 37 L26 37 L26 18 L22 18 L22 37 L17 37 Z" /><line x1="17" y1="16" x2="31" y2="16" /></>),
  skirt: (<><path d="M18 15 L30 15 L34 36 L14 36 Z" /><line x1="18" y1="18" x2="30" y2="18" /></>),
  // Outerwear
  blazer: (<><path d="M17 13 L14 17 L17 37 L31 37 L34 17 L31 13" /><polyline points="20,13 24,25 20,33" /><polyline points="28,13 24,25 28,33" /><circle cx="24" cy="30" r="1" /></>),
  "denim-jacket": (<><path d="M17 13 L13 16 L16 20 L16 37 L32 37 L32 20 L35 16 L31 13" /><line x1="24" y1="15" x2="24" y2="37" /><rect x="18" y="23" width="5" height="4" /><rect x="25" y="23" width="5" height="4" /></>),
  coat: (<><path d="M17 13 L14 17 L16 20 L16 40 L32 40 L32 20 L34 17 L31 13" /><polyline points="21,13 24,16 27,13" /><line x1="24" y1="16" x2="24" y2="40" /><circle cx="24" cy="24" r="1" /><circle cx="24" cy="30" r="1" /></>),
  "rain-jacket": (<><path d="M18 16 Q24 10 30 16" /><path d="M17 16 L14 19 L17 22 L17 38 L31 38 L31 22 L34 19 L31 16" /><line x1="24" y1="16" x2="24" y2="38" /></>),
  // Shoes
  sandals: (<><ellipse cx="24" cy="32" rx="12" ry="3.5" /><path d="M16 30 L24 24 L32 30" /><line x1="24" y1="24" x2="24" y2="32" /></>),
  espadrilles: (<><path d="M13 30 Q13 25 19 25 L30 25 Q35 26 35 30 Z" /><path d="M13 30 L35 30 L34 34 Q24 36 14 34 Z" /><line x1="15" y1="32" x2="17" y2="34" /><line x1="20" y1="32" x2="22" y2="34" /><line x1="25" y1="32" x2="27" y2="34" /><line x1="30" y1="32" x2="32" y2="34" /></>),
  "heeled-sandals": (<><path d="M14 29 L33 29 L33 32 L18 32 Q14 32 14 29 Z" /><path d="M31 32 L31 38 L28 38" /><path d="M16 29 Q20 23 27 27" /></>),
  sneakers: (<><path d="M12 33 L12 27 Q15 25 19 26 L27 28 Q31 29 35 31 L36 33 Z" /><line x1="12" y1="33" x2="36" y2="33" /><line x1="19" y1="27" x2="21" y2="30" /><line x1="22" y1="27" x2="24" y2="30" /></>),
  // Bags
  "straw-tote": (<><path d="M15 20 L33 20 L35 36 L13 36 Z" /><path d="M20 20 Q20 13 24 13 Q28 13 28 20" /><line x1="15" y1="26" x2="33" y2="26" /><line x1="18" y1="20" x2="20" y2="36" /><line x1="24" y1="20" x2="24" y2="36" /><line x1="30" y1="20" x2="28" y2="36" /></>),
  crossbody: (<><path d="M17 22 L31 22 L30 33 L18 33 Z" /><path d="M17 22 L15 15 L28 12" /><line x1="17" y1="25" x2="31" y2="25" /><rect x="22" y="27" width="4" height="3" rx="1" /></>),
  clutch: (<><path d="M13 24 L35 24 L35 33 L13 33 Z" /><path d="M13 24 L24 29 L35 24" /><circle cx="24" cy="29" r="1" /></>),
  // Accessories
  sunglasses: (<><rect x="10" y="22" width="11" height="8" rx="4" /><rect x="27" y="22" width="11" height="8" rx="4" /><line x1="21" y1="24" x2="27" y2="24" /></>),
  "sun-hat": (<><path d="M16 29 Q24 20 32 29" /><ellipse cx="24" cy="30" rx="15" ry="3.5" /></>),
  scarf: (<><path d="M18 12 Q22 24 18 36" /><path d="M26 12 Q30 24 26 36" /><line x1="18" y1="12" x2="26" y2="12" /></>),
  earrings: (<><circle cx="19" cy="15" r="1.6" /><path d="M19 16.5 L19 22" /><path d="M15 22 Q19 31 23 22 Z" /><circle cx="30" cy="15" r="1.6" /><path d="M30 16.5 L30 22" /><path d="M26 22 Q30 31 34 22 Z" /></>),
};

// The tinted icon frame used as the last resort before a flat swatch. Falls back
// to the swatch gradient when we have no icon for the kind (or no kind at all).
function KindIcon({ kind, color = "#8A8172", height, radius = 6 }) {
  const art = KIND_ICON_ART[kind];
  if (!art) {
    return <div style={{ height, borderRadius: radius, background: `linear-gradient(160deg, ${color}, ${color}CC)` }} />;
  }
  return (
    <div style={{ height, width: "100%", borderRadius: radius, background: `${color}22`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <svg viewBox="0 0 48 48" width="58%" height="58%" fill="none" stroke="#3A342C" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7, maxWidth: 120, maxHeight: 120 }}>
        {art}
      </svg>
    </div>
  );
}

// Renders the best available product image, walking a fallback chain until one
// loads: the merchant's own photo → Awin's resized copy → a local per-category
// placeholder (public/products/<kind>.jpg) → a colour-swatch gradient. This is
// the single place image logic lives, so every card behaves consistently, and
// it means dropping placeholder photos into public/products/ lights them up
// everywhere at once without touching any card. `kind` is optional — items
// without one (e.g. some liked feed items) just skip the placeholder step.
function ProductVisual({ imageUrl, imageFallback, color, kind, height, radius = 6, fit = "cover" }) {
  const sources = useMemo(
    () => [imageUrl, imageFallback, kindImage(kind)]
      .map((s) => (s ? String(s).trim() : ""))
      .filter(Boolean),
    [imageUrl, imageFallback, kind]
  );
  const [stage, setStage] = useState(0);
  // Reset to the top of the chain whenever the inputs change, so a broken image
  // on one card doesn't poison the next.
  useEffect(() => { setStage(0); }, [imageUrl, imageFallback, kind]);

  const src = stage < sources.length ? sources[stage] : null;

  if (src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setStage((s) => s + 1)}
        style={{ width: "100%", height, borderRadius: radius, objectFit: fit, display: "block", background: fit === "contain" ? "#EDE9E2" : `${color}33` }}
      />
    );
  }
  // No usable photo: show the line-art icon for this kind (or, if we don't have
  // one, the plain colour swatch — handled inside KindIcon).
  return <KindIcon kind={kind} color={color} height={height} radius={radius} />;
}

function MatchCard({ item, factors, index }) {
  const onSale = item.was && item.was > item.price;
  return (
    <div style={{ background: "#fff", borderRadius: 10, padding: 12, border: "1px solid #E4DDCE" }}>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ width: 15, height: 15, borderRadius: "50%", background: "#211D18", color: "#EDE7DD", fontSize: 9.5, fontFamily: FONT_MONO, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
          {index + 1}
        </div>
        <div style={{ width: 42, height: 42, flexShrink: 0 }}>
          <ProductVisual imageUrl={item.imageUrl} imageFallback={item.imageFallback} color={item.color} kind={item.kind} height={42} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.3 }}>{item.title}</div>
          <div style={{ fontSize: 11, color: "#8A8172", marginTop: 1 }}>{item.store}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 12 }}>
            {onSale && <span style={{ textDecoration: "line-through", color: "#8A8172", marginRight: 4, fontSize: 10.5 }}>${item.was}</span>}
            <span style={{ color: onSale ? "#B85C38" : "#211D18", fontWeight: 500 }}>${item.price}</span>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 9, paddingLeft: 25, flexWrap: "wrap", gap: 6 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {factors.slice(0, 2).map((f, j) => (
            <span key={j} style={{ fontSize: 10, background: "#F2ECE0", color: "#74856A", padding: "3px 8px", borderRadius: 999, fontFamily: FONT_MONO }}>
              {f.detail}
            </span>
          ))}
        </div>
        {(() => {
          const { url, tracked } = buyLinkFor(item);
          return (
            <a href={url} target="_blank" rel={tracked ? "noopener noreferrer sponsored" : "noopener noreferrer"} className="focus-ring" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#74856A", textDecoration: "none", flexShrink: 0 }}>
              {tracked ? "view" : "find it"} <ExternalLink size={9} />
            </a>
          );
        })()}
      </div>
    </div>
  );
}

const GLOBAL_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
  * { box-sizing: border-box; }
  button { font-family: inherit; cursor: pointer; }
  input, select { font-family: inherit; }
  .focus-ring:focus-visible { outline: 2px solid #B85C38; outline-offset: 2px; }
  .mb-scroll::-webkit-scrollbar { width: 8px; }
  .mb-scroll::-webkit-scrollbar-thumb { background: #D8D0C0; border-radius: 4px; }
  .pin-card { transition: transform 0.22s ease, box-shadow 0.22s ease; }
  .pin-card:hover { transform: translateY(-4px) rotate(0deg) !important; box-shadow: 0 18px 30px -12px rgba(33,29,24,0.28) !important; z-index: 5; }
  .rec-card { transition: transform 0.2s ease, box-shadow 0.2s ease; }
  .rec-card:hover { transform: translateY(-3px); box-shadow: 0 14px 24px -10px rgba(33,29,24,0.22); }
  .tracked-row { transition: background 0.15s ease; }
  .tracked-row:hover { background: #F2ECE0; }
  .alert-card { animation: slideIn 0.35s ease; }
  @keyframes slideIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
  .item-row { transition: background 0.15s ease; }
  .item-row:hover { background: #F2ECE0; }
  .checkbox { transition: background 0.15s ease, border-color 0.15s ease; }
  .trip-card { transition: transform 0.2s ease, box-shadow 0.2s ease; }
  .trip-card:hover { transform: translateY(-4px); box-shadow: 0 20px 34px -16px rgba(33,29,24,0.3); }
  .like-btn { transition: transform 0.15s ease; }
  .like-btn:active { transform: scale(0.85); }
  .nav-tab { transition: background 0.15s ease, color 0.15s ease; }
  @media (prefers-reduced-motion: reduce) {
    .pin-card, .rec-card, .alert-card, .trip-card, .like-btn { transition: none !important; animation: none !important; }
  }
`;

/* ---------------------------------------------------
   SCREEN: DISCOVER (swipe feed)
--------------------------------------------------- */

const DISCOVER_CATEGORIES = ["all", "tops", "knitwear", "outerwear", "bottoms", "dresses", "shoes", "swimwear", "bags", "accessories"];

// A branded "coming soon" placeholder used for features that are built but
// waiting on real product data (Discover's taste engine, Watch's price alerts).
// The tab stays visible so users know what's coming; the real screen is one
// line away in the router when the data layer is ready.
function ComingSoon({ icon: Icon, title, description, points = [] }) {
  return (
    <div style={{ padding: "56px 32px 80px", display: "flex", justifyContent: "center" }}>
      <div style={{ maxWidth: 540, width: "100%", textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#EFE7D8", color: "#B85C38", fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", borderRadius: 999, padding: "5px 12px", marginBottom: 22 }}>
          <Sparkles size={12} /> coming soon
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
          <div style={{ width: 66, height: 66, borderRadius: 20, background: "#F7F3EA", border: "1px solid #E4DDCE", display: "flex", alignItems: "center", justifyContent: "center", color: "#74856A" }}>
            <Icon size={28} />
          </div>
        </div>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 500, fontSize: 30, margin: "0 0 12px", letterSpacing: "-0.01em" }}>{title}</h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: "#6E6B64", margin: "0 auto 28px", maxWidth: 460 }}>{description}</p>
        {points.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, textAlign: "left", maxWidth: 400, margin: "0 auto" }}>
            {points.map((p, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 11, background: "#F7F3EA", border: "1px solid #E4DDCE", borderRadius: 12, padding: "13px 15px" }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, background: "#74856A", color: "#F7F3EA", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                  <Check size={13} />
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "#211D18" }}>{p}</div>
              </div>
            ))}
          </div>
        )}
        <p style={{ fontSize: 12.5, color: "#8A8172", margin: "26px 0 0", lineHeight: 1.5 }}>
          We're putting the finishing touches on this. Plan a trip and build your closet in the meantime — it all connects here.
        </p>
      </div>
    </div>
  );
}

function DiscoverScreen({ liked, setLiked, watchlist, onToggleWatch }) {
  const [category, setCategory] = useState("all");
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState([]); // [{ id, action }] for undo
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [exiting, setExiting] = useState(null); // 'like' | 'pass'
  const startX = useRef(0);

  // Real affiliate products, loaded once. Falls back to the sample catalog if
  // the feed is unavailable so the deck is never empty.
  const [feedProducts, setFeedProducts] = useState([]);
  const [feedState, setFeedState] = useState("loading"); // loading | ready | error

  useEffect(() => {
    let cancelled = false;
    fetchFeedProducts()
      .then((p) => {
        if (cancelled) return;
        setFeedProducts(p);
        setFeedState("ready");
      })
      .catch(() => { if (!cancelled) setFeedState("error"); });
    return () => { cancelled = true; };
  }, []);

  // Real products lead; the sample catalog fills categories the feed doesn't
  // cover yet (Ecosusi is bags/accessories only). As more advertisers are
  // approved, real products naturally crowd the samples out.
  const allProducts = useMemo(() => {
    if (feedProducts.length === 0) return CATALOG;
    const feedCats = new Set(feedProducts.map((p) => p.category));
    const samples = CATALOG.filter((c) => !feedCats.has(c.category));
    return [...feedProducts, ...samples];
  }, [feedProducts]);

  const deck = useMemo(
    () => allProducts.filter((c) => category === "all" || c.category === category),
    [allProducts, category]
  );

  // Reset position when the category changes so each deck starts fresh.
  useEffect(() => {
    setIndex(0);
    setHistory([]);
    setDragX(0);
    setExiting(null);
  }, [category, feedState]);

  const current = deck[index];
  const next = deck[index + 1];
  const done = index >= deck.length;

  const commit = useCallback(
    (action) => {
      if (!current) return;
      setExiting(action);
      // let the card animate out before advancing
      setTimeout(() => {
        if (action === "like") setLiked((l) => (l.some((x) => x.id === current.id) ? l : [...l, current]));
        setHistory((h) => [...h, { id: current.id, action }]);
        setIndex((i) => i + 1);
        setDragX(0);
        setExiting(null);
      }, 220);
    },
    [current, setLiked]
  );

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    if (last.action === "like") setLiked((l) => l.filter((x) => x.id !== last.id));
    setHistory((h) => h.slice(0, -1));
    setIndex((i) => Math.max(0, i - 1));
    setDragX(0);
  }, [history, setLiked]);

  // Pointer drag (works for mouse and touch via pointer events)
  const onPointerDown = (e) => {
    if (!current || exiting) return;
    setDragging(true);
    startX.current = e.clientX;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragging) return;
    setDragX(e.clientX - startX.current);
  };
  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    const threshold = 110;
    if (dragX > threshold) commit("like");
    else if (dragX < -threshold) commit("pass");
    else setDragX(0);
  };

  // Keyboard support — swipe-only would exclude keyboard and screen reader users.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowRight") commit("like");
      if (e.key === "ArrowLeft") commit("pass");
      if (e.key.toLowerCase() === "z") undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit, undo]);

  const offset = exiting === "like" ? 520 : exiting === "pass" ? -520 : dragX;
  const rotation = offset / 22;
  const likeOpacity = Math.max(0, Math.min(1, offset / 110));
  const passOpacity = Math.max(0, Math.min(1, -offset / 110));

  return (
    <div>
      <header style={{ padding: "28px 32px 18px", borderBottom: "1px solid #D8D0C0" }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.14em", color: "#74856A", textTransform: "uppercase", marginBottom: 4 }}>
          {liked.length} liked · {watchlist.length} watching
        </div>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 500, fontSize: 34, margin: 0, letterSpacing: "-0.01em" }}>Discover</h1>

        <div style={{ display: "flex", gap: 6, marginTop: 18, flexWrap: "wrap" }}>
          {DISCOVER_CATEGORIES.map((c) => (
            <button
              key={c}
              className="focus-ring"
              onClick={() => setCategory(c)}
              style={{
                padding: "7px 13px",
                borderRadius: 999,
                border: "1px solid " + (category === c ? "#211D18" : "#D8D0C0"),
                background: category === c ? "#211D18" : "transparent",
                color: category === c ? "#EDE7DD" : "#211D18",
                fontSize: 12.5,
                textTransform: "capitalize",
              }}
            >
              {c}
            </button>
          ))}
        </div>
      </header>

      <div style={{ padding: "32px 20px 60px", display: "flex", flexDirection: "column", alignItems: "center" }}>
        {done ? (
          <div style={{ width: "100%", maxWidth: 420, textAlign: "center" }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, marginBottom: 8 }}>
              That's everything in {category === "all" ? "your feed" : category}
            </div>
            <p style={{ fontSize: 13, color: "#8A8172", margin: "0 0 24px", lineHeight: 1.6 }}>
              You liked {history.filter((h) => h.action === "like").length} of {history.length} pieces. Those are shaping what we show you next.
            </p>

            {liked.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "#74856A", marginBottom: 12 }}>
                  what you liked
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                  {liked.slice(-8).map((item) => (
                    <div key={item.id} style={{ width: 62 }}>
                      <ProductVisual imageUrl={item.imageUrl} imageFallback={item.imageFallback} color={item.color} kind={item.kind} height={80} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {category !== "all" && (
                <button className="focus-ring" onClick={() => setCategory("all")} style={{ background: "#211D18", color: "#EDE7DD", border: "none", borderRadius: 999, padding: "11px 20px", fontSize: 13.5 }}>
                  Browse everything
                </button>
              )}
              <button className="focus-ring" onClick={() => { setIndex(0); setHistory([]); }} style={{ background: "none", color: "#211D18", border: "1px solid #D8D0C0", borderRadius: 999, padding: "11px 20px", fontSize: 13.5 }}>
                Start over
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* card stack */}
            <div style={{ position: "relative", width: "100%", maxWidth: 380, height: 520, marginBottom: 24 }}>
              {/* the next card peeking behind */}
              {next && (
                <div style={{ position: "absolute", inset: 0, transform: "scale(0.95) translateY(12px)", opacity: 0.55, pointerEvents: "none" }}>
                  <SwipeCard item={next} />
                </div>
              )}

              {current && (
                <div
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  style={{
                    position: "absolute",
                    inset: 0,
                    transform: `translateX(${offset}px) rotate(${rotation}deg)`,
                    transition: dragging ? "none" : "transform 0.22s ease",
                    cursor: dragging ? "grabbing" : "grab",
                    touchAction: "none",
                  }}
                >
                  <SwipeCard
                    item={current}
                    watching={watchlist.some((w) => w.id === current.id)}
                    onToggleWatch={() => onToggleWatch(current)}
                    likeOpacity={likeOpacity}
                    passOpacity={passOpacity}
                  />
                </div>
              )}
            </div>

            {/* controls */}
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <button
                aria-label="Pass"
                className="focus-ring"
                onClick={() => commit("pass")}
                style={{ width: 58, height: 58, borderRadius: "50%", border: "1px solid #D8D0C0", background: "#F7F3EA", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 10px -6px rgba(33,29,24,0.2)" }}
              >
                <X size={24} color="#8A8172" />
              </button>

              <button
                aria-label="Undo last swipe"
                className="focus-ring"
                onClick={undo}
                disabled={history.length === 0}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  border: "1px solid #D8D0C0",
                  background: "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: history.length === 0 ? 0.35 : 1,
                  cursor: history.length === 0 ? "default" : "pointer",
                }}
              >
                <RotateCcw size={17} color="#211D18" />
              </button>

              <button
                aria-label="Like"
                className="focus-ring"
                onClick={() => commit("like")}
                style={{ width: 58, height: 58, borderRadius: "50%", border: "none", background: "#B85C38", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 14px -6px rgba(184,92,56,0.5)" }}
              >
                <Heart size={22} color="#F7F3EA" fill="#F7F3EA" />
              </button>
            </div>

            <div style={{ fontSize: 11, color: "#8A8172", marginTop: 16, fontFamily: FONT_MONO }}>
              swipe, tap, or use ← → keys
            </div>
            <p style={{ fontSize: 10, color: "#A39B8A", marginTop: 10, lineHeight: 1.5, maxWidth: 320 }}>{AFFILIATE_DISCLOSURE}</p>
          </>
        )}
      </div>
    </div>
  );
}

function SwipeCard({ item, watching, onToggleWatch, likeOpacity = 0, passOpacity = 0 }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#F7F3EA",
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: "0 18px 40px -18px rgba(33,29,24,0.35)",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        userSelect: "none",
      }}
    >
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0 }}>
          <ProductVisual imageUrl={item.imageUrl} imageFallback={item.imageFallback} color={item.color} kind={item.kind} height="100%" radius={0} />
        </div>

        {/* watchlist toggle */}
        {onToggleWatch && (
          <button
            aria-label={watching ? `Remove ${item.title} from watchlist` : `Add ${item.title} to watchlist`}
            className="focus-ring"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleWatch();
            }}
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              width: 38,
              height: 38,
              borderRadius: "50%",
              border: "none",
              background: "rgba(247,243,234,0.92)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 10px -4px rgba(33,29,24,0.3)",
            }}
          >
            <Star size={17} color="#C79A44" fill={watching ? "#C79A44" : "none"} />
          </button>
        )}

        {/* swipe intent overlays */}
        <div style={{ position: "absolute", top: 16, left: 16, opacity: likeOpacity, transition: "opacity 0.1s", pointerEvents: "none" }}>
          <span style={{ border: "2.5px solid #74856A", color: "#74856A", padding: "5px 12px", borderRadius: 8, fontFamily: FONT_MONO, fontSize: 15, fontWeight: 600, letterSpacing: "0.08em", background: "rgba(247,243,234,0.85)", transform: "rotate(-12deg)", display: "inline-block" }}>
            LIKE
          </span>
        </div>
        <div style={{ position: "absolute", top: 16, right: 16, opacity: passOpacity, transition: "opacity 0.1s", pointerEvents: "none" }}>
          <span style={{ border: "2.5px solid #B85C38", color: "#B85C38", padding: "5px 12px", borderRadius: 8, fontFamily: FONT_MONO, fontSize: 15, fontWeight: 600, letterSpacing: "0.08em", background: "rgba(247,243,234,0.85)", transform: "rotate(12deg)", display: "inline-block" }}>
            PASS
          </span>
        </div>
      </div>

      {/* details — small, so the image dominates */}
      <div style={{ padding: "13px 16px 15px", borderTop: "1px solid #E4DDCE", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</div>
          <div style={{ fontSize: 11.5, color: "#8A8172", marginTop: 2 }}>{item.store}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 14 }}>
            {item.was && item.was > item.price && (
              <span style={{ textDecoration: "line-through", color: "#8A8172", fontSize: 11.5, marginRight: 5 }}>${item.was}</span>
            )}
            <span style={{ color: item.was && item.was > item.price ? "#B85C38" : "#211D18", fontWeight: 500 }}>${item.price}</span>
          </div>
          {/* Buy link. Feed products carry the tracked aw_deep_link (that's the
              click that earns) so it always wins; seed items fall back to a
              retailer search so the card is never a dead end. Stops propagation
              so it doesn't trigger a swipe. */}
          {(() => {
            const { url, tracked } = buyLinkFor(item);
            return (
              <a
                href={url}
                target="_blank"
                rel={tracked ? "noopener noreferrer sponsored" : "noopener noreferrer"}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className="focus-ring"
                aria-label={`${tracked ? "View" : "Find"} ${item.title} at ${item.store}`}
                style={{ display: "flex", alignItems: "center", gap: 4, background: "#211D18", color: "#EDE7DD", borderRadius: 999, padding: "6px 11px", fontSize: 11, textDecoration: "none" }}
              >
                {tracked ? "View" : "Find it"} <ExternalLink size={10} />
              </a>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------
   SCREEN: WATCH (live feed)
--------------------------------------------------- */

function WatchScreen({ tracked, setTracked }) {
  const [notifyAll, setNotifyAll] = useState(true);
  const [filter, setFilter] = useState("all"); // all | sale

  const onSale = useMemo(
    () => tracked.filter((i) => i.droppedAt || (i.history?.length > 1 && i.history[i.history.length - 1] < i.history[0])),
    [tracked]
  );

  const visible = useMemo(
    () => (filter === "sale" ? onSale : tracked),
    [filter, onSale, tracked]
  );

  const removeItem = (id) => setTracked((t) => t.filter((x) => x.id !== id));
  const toggleNotify = (id) =>
    setTracked((t) => t.map((x) => (x.id === id ? { ...x, notify: x.notify === false ? true : false } : x)));

  return (
    <div>
      <header style={{ padding: "28px 32px 20px", borderBottom: "1px solid #D8D0C0" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.14em", color: "#74856A", textTransform: "uppercase", marginBottom: 4 }}>
              {tracked.length} {tracked.length === 1 ? "item" : "items"}
              {onSale.length > 0 && ` · ${onSale.length} on sale`}
            </div>
            <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 500, fontSize: 34, margin: 0, letterSpacing: "-0.01em" }}>Watchlist</h1>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {[
              { id: "all", label: "Everything" },
              { id: "sale", label: `On sale${onSale.length ? ` (${onSale.length})` : ""}` },
            ].map((f) => (
              <button
                key={f.id}
                className="focus-ring"
                onClick={() => setFilter(f.id)}
                style={{
                  padding: "7px 14px",
                  borderRadius: 999,
                  border: "1px solid " + (filter === f.id ? "#211D18" : "#D8D0C0"),
                  background: filter === f.id ? "#211D18" : "transparent",
                  color: filter === f.id ? "#EDE7DD" : "#211D18",
                  fontSize: 12.5,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* master notification toggle */}
          <button
            className="focus-ring"
            onClick={() => setNotifyAll((n) => !n)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 14px",
              borderRadius: 999,
              border: "1px solid #D8D0C0",
              background: notifyAll ? "#F2ECE0" : "transparent",
              fontSize: 12.5,
            }}
          >
            {notifyAll ? <Bell size={13} color="#74856A" /> : <BellOff size={13} color="#8A8172" />}
            {notifyAll ? "Sale alerts on" : "Sale alerts off"}
          </button>
        </div>
      </header>

      <div style={{ padding: "22px 32px 60px", maxWidth: 760 }}>
        {visible.length === 0 ? (
          <div style={{ border: "1.5px dashed #C9BFA9", borderRadius: 14, padding: "44px 24px", textAlign: "center", color: "#8A8172", fontSize: 13.5 }}>
            {tracked.length === 0
              ? "Nothing here yet. Star items while you're browsing to watch them."
              : "Nothing on sale right now. We'll let you know the moment something drops."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {visible.map((item) => {
              const current = item.history[item.history.length - 1];
              const original = item.history[0];
              const dropped = current < original;
              const pct = dropped ? Math.round((1 - current / original) * 100) : 0;
              const muted = item.notify === false || !notifyAll;

              return (
                <div
                  key={item.id}
                  className="tracked-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    background: "#F7F3EA",
                    border: "1px solid " + (dropped ? "#E8C4B4" : "#E4DDCE"),
                    borderLeft: dropped ? "3px solid #B85C38" : "1px solid #E4DDCE",
                    borderRadius: 10,
                    padding: "12px 14px",
                  }}
                >
                  <div style={{ width: 52, height: 52, flexShrink: 0 }}>
                    <ProductVisual imageUrl={item.imageUrl} imageFallback={item.imageFallback} color={item.color || "#8A8172"} kind={item.kind} height={52} />
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: 11.5, color: "#8A8172", marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span>{item.store}</span>
                      {dropped && (
                        <>
                          <span>·</span>
                          <span style={{ color: "#B85C38", fontWeight: 500 }}>dropped {item.droppedAt || "recently"}</span>
                        </>
                      )}
                      {muted && (
                        <>
                          <span>·</span>
                          <span>alerts off</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontFamily: FONT_MONO, fontSize: 14.5, fontWeight: 500, color: dropped ? "#B85C38" : "#211D18" }}>
                      ${current}
                    </div>
                    {dropped && (
                      <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: "#8A8172" }}>
                        <span style={{ textDecoration: "line-through" }}>${original}</span>
                        <span style={{ color: "#B85C38", marginLeft: 5 }}>−{pct}%</span>
                      </div>
                    )}
                  </div>

                  <button
                    aria-label={muted ? `Turn on alerts for ${item.title}` : `Turn off alerts for ${item.title}`}
                    className="focus-ring"
                    onClick={() => toggleNotify(item.id)}
                    style={{ background: "none", border: "none", padding: 5, flexShrink: 0 }}
                  >
                    {item.notify === false ? <BellOff size={15} color="#8A8172" /> : <Bell size={15} color="#211D18" />}
                  </button>

                  <a
                    href={item.sourceUrl || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`View ${item.title} at ${item.store}`}
                    className="focus-ring"
                    style={{ padding: 5, flexShrink: 0, display: "flex", color: "#74856A" }}
                  >
                    <ExternalLink size={15} />
                  </a>

                  <button
                    aria-label={`Stop watching ${item.title}`}
                    className="focus-ring"
                    onClick={() => removeItem(item.id)}
                    style={{ background: "none", border: "none", padding: 5, flexShrink: 0, color: "#8A8172" }}
                  >
                    <X size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {tracked.length > 0 && (
          <p style={{ fontSize: 11.5, color: "#8A8172", marginTop: 20, lineHeight: 1.6 }}>
            Sale alerts are checked continuously. You'll be notified as soon as anything you're
            watching drops below its recent price.
          </p>
        )}
      </div>
    </div>
  );
}

// Debounced place search. Fires ~300ms after typing stops rather than on every
// keystroke — the API is rate-limited and per-character calls would burn quota.
function PlaceAutocomplete({ value, onChange, onSelect, placeholder, autoFocus, type = "city", bias = [] }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [highlight, setHighlight] = useState(0);
  const timer = useRef(null);
  const boxRef = useRef(null);
  // Array identity changes every render; a joined string is stable, which keeps
  // the effect below from re-firing on every parent render.
  const biasKey = bias.join(",");

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!value || value.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    setError(null);
    timer.current = setTimeout(async () => {
      try {
        const r = await searchPlaces(value, type, biasKey ? biasKey.split(",") : []);
        setResults(r);
        setOpen(r.length > 0);
        setHighlight(0);
      } catch (e) {
        setError("Couldn't search places");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => timer.current && clearTimeout(timer.current);
  }, [value, type, biasKey]);

  // close on outside click
  useEffect(() => {
    const onDoc = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const choose = (place) => {
    onSelect(place);
    setOpen(false);
    setResults([]);
  };

  const onKeyDown = (e) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    if (e.key === "Enter") { e.preventDefault(); choose(results[highlight]); }
    if (e.key === "Escape") setOpen(false);
  };

  return (
    <div ref={boxRef} style={{ position: "relative", flex: 1 }}>
      <input
        className="focus-ring"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder={placeholder}
        style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid #D8D0C0", fontSize: 13.5, background: "#fff" }}
      />
      {loading && (
        <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "#8A8172", fontFamily: FONT_MONO }}>
          …
        </span>
      )}
      {error && !loading && (
        <div style={{ fontSize: 11, color: "#B85C38", marginTop: 4 }}>{error}</div>
      )}
      {open && results.length > 0 && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#fff", border: "1px solid #D8D0C0", borderRadius: 8, boxShadow: "0 12px 24px -10px rgba(33,29,24,0.3)", zIndex: 30, overflow: "hidden" }}>
          {results.map((p, i) => (
            <button
              key={p.id}
              onClick={() => choose(p)}
              onMouseEnter={() => setHighlight(i)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "9px 12px",
                background: i === highlight ? "#F2ECE0" : "transparent",
                border: "none",
                textAlign: "left",
                fontSize: 13,
              }}
            >
              <MapPin size={12} color="#8A8172" style={{ flexShrink: 0 }} />
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------
   SCREEN: TRIP PLANNER
--------------------------------------------------- */

// Decides whether an item is relevant and how many to bring, from REAL weather.
// Previously these were hardcoded arrays; now conditions come from the API, so
// suggestions change with the actual forecast.
// Decide whether a candidate item belongs on THIS trip, how many, and why.
// Driven entirely by the declarative gating fields on the item + the aggregated
// forecast (conditions), so adding a new item never means touching this function.
function recommendFor(item, conditions, legs, tripDays) {
  const coastalDays = legs.filter((l) => l.coastal).reduce((s, l) => s + (l.nights || 0), 0);

  // Quantity: scale with trip length, clamp to the item's sensible range.
  const base = item.perDays ? Math.ceil(tripDays / item.perDays) + (item.spare ? 1 : 0) : null;
  const qty = base != null
    ? Math.min(item.qtyMax != null ? item.qtyMax : 99, Math.max(item.qtyMin != null ? item.qtyMin : 1, base))
    : null;

  const gated = item.warmMin != null || item.coolMax != null || item.rain || item.sun || item.coastal;

  // Weather not loaded yet — show only ungated essentials so we never surface
  // contradictory picks (e.g. a parka and swimwear) before the forecast lands.
  if (!conditions) {
    if (gated) return { show: false };
    return { show: true, qty, reason: item.reason };
  }

  const { maxHi, minLo, rainDays, sunDays } = conditions;

  if (item.warmMin != null && maxHi < item.warmMin) return { show: false };
  if (item.coolMax != null && minLo > item.coolMax) return { show: false };
  if (item.rain && rainDays === 0) return { show: false };
  // Sun gear is relevant when it's sunny — or simply hot, since UV is high near
  // the equator and the coast even under cloud cover.
  if (item.sun && sunDays === 0 && maxHi < 24) return { show: false };
  if (item.coastal && coastalDays === 0) return { show: false };

  let reason = item.reason;
  if (item.why === "rain") reason = `rain forecast on ${rainDays} ${rainDays === 1 ? "day" : "days"}`;
  else if (item.why === "coastal") reason = `${coastalDays} coastal ${coastalDays === 1 ? "day" : "days"}, up to ${maxHi}°C`;
  else if (item.why === "warm") reason = `warm days up to ${maxHi}°C`;
  else if (item.why === "cool") reason = `lows around ${minLo}°C`;

  return { show: true, qty, reason };
}

// A "popularity" score used when we have no style signal to rank on: favour the
// hand-picked `popular` items, then whatever's discounted hardest. Keeps the
// shop picker from ever showing an empty or arbitrary list.
function trendScore(item) {
  let s = 0;
  if (item.popular) s += 2;
  if (item.was && item.was > item.price) s += (1 - item.price / item.was); // 0–1 by discount depth
  return s;
}

function shopMatchesFor(target, pins) {
  if (!target || !target.category) return [];
  const climate = requiredClimateFor(target);

  // Filter to the same fine-grained kind first (so "Sunglasses" returns
  // sunglasses, not belts). Only widen to the whole category if the kind match
  // comes up empty — e.g. a target with no kind, or a kind we don't stock yet.
  const suits = (c) => pieceSuits(c, climate);
  let candidates =
    target.kind
      ? CATALOG.filter((c) => c.kind === target.kind && suits(c))
      : [];
  if (candidates.length === 0) {
    candidates = CATALOG.filter((c) => c.category === target.category && suits(c));
  }
  if (candidates.length === 0) return [];

  const scored = candidates.map((item) => {
    const s = scoreAgainstBoard(item, pins, null);
    // Blend in a small popularity term so that when the style signal is thin
    // (few or no pins, or nothing tonally close) we still surface sensible,
    // on-trend picks instead of a flat or arbitrary order.
    const trend = trendScore(item);
    return { item, ...s, total: s.total + trend * 0.4, factors: s.factors };
  });

  // When there's no real style signal at all, say so honestly: label these as
  // popular picks rather than pretending they matched a taste profile.
  const haveSignal = pins.length > 0 && scored.some((r) => r.total - trendScore(r.item) * 0.4 > 0.3);
  return scored
    .map((r) =>
      haveSignal
        ? r
        : { ...r, factors: [{ detail: r.item.popular ? "a popular pick right now" : "on-trend pick", weight: 1 }] }
    )
    .sort((a, b) => b.total - a.total)
    .slice(0, 4);
}

/* ---------------------------------------------------
   OWNED WARDROBE
   The closet the user owns, seeded via the setup grid. Packing checks this
   first: an owned piece that suits the weather reads as "in your closet",
   otherwise the row is a gap. Either way the shop match stays one tap away,
   so the flow stays shopping-centric.
--------------------------------------------------- */

// `kind` mirrors the catalogue's fine-grained type so an owned belt counts as a
// belt (not as "accessories" writ large) when we check what a user already has.
const WARDROBE_ARCHETYPES = [
  // Tops & knitwear
  { id: "w-tank", label: "Tank tops / camis", kind: "tank", category: "tops", climate: "warm" },
  { id: "w-blouse", label: "Blouses", kind: "blouse", category: "tops", climate: "warm" },
  { id: "w-crochet-top", label: "Crochet top", kind: "crochet-top", category: "tops", climate: "warm" },
  { id: "w-sweater", label: "Knit sweater", kind: "sweater", category: "knitwear", climate: "cool" },
  { id: "w-cardigan", label: "Cardigan", kind: "cardigan", category: "knitwear", climate: "cool" },
  // Dresses & one-piece outfits
  { id: "w-sundress", label: "Sundress", kind: "sundress", category: "dresses", climate: "warm" },
  { id: "w-maxi-dress", label: "Maxi dress", kind: "maxi-dress", category: "dresses", climate: "warm" },
  { id: "w-slip-dress", label: "Slip dress", kind: "slip-dress", category: "dresses", climate: "any" },
  { id: "w-cocktail-dress", label: "Cocktail dress", kind: "cocktail-dress", category: "dresses", climate: "any" },
  { id: "w-gown", label: "Formal gown", kind: "gown", category: "dresses", climate: "any" },
  { id: "w-romper", label: "Romper / playsuit", kind: "romper", category: "dresses", climate: "warm" },
  { id: "w-jumpsuit", label: "Jumpsuit", kind: "jumpsuit", category: "dresses", climate: "any" },
  { id: "w-coord", label: "Matching set / co-ord", kind: "coord", category: "dresses", climate: "warm" },
  // Swim & beach
  { id: "w-bikini", label: "Bikini", kind: "bikini", category: "swimwear", climate: "water" },
  { id: "w-one-piece", label: "One-piece swimsuit", kind: "one-piece", category: "swimwear", climate: "water" },
  { id: "w-coverup", label: "Beach cover-up", kind: "coverup", category: "swimwear", climate: "water" },
  { id: "w-kaftan", label: "Kaftan", kind: "kaftan", category: "swimwear", climate: "warm" },
  // Bottoms
  { id: "w-wide-leg-pants", label: "Wide-leg trousers", kind: "wide-leg-pants", category: "bottoms", climate: "warm" },
  { id: "w-shorts", label: "Shorts", kind: "shorts", category: "bottoms", climate: "warm" },
  { id: "w-jeans", label: "Jeans", kind: "jeans", category: "bottoms", climate: "any" },
  { id: "w-skirt", label: "Skirt", kind: "skirt", category: "bottoms", climate: "warm" },
  // Outerwear / layers
  { id: "w-blazer", label: "Blazer", kind: "blazer", category: "outerwear", climate: "any" },
  { id: "w-denim-jacket", label: "Denim jacket", kind: "denim-jacket", category: "outerwear", climate: "any" },
  { id: "w-coat", label: "Trench / coat", kind: "coat", category: "outerwear", climate: "cool" },
  { id: "w-rain", label: "Rain jacket", kind: "rain-jacket", category: "outerwear", climate: "rain" },
  // Shoes
  { id: "w-sandals", label: "Flat sandals", kind: "sandals", category: "shoes", climate: "warm" },
  { id: "w-espadrilles", label: "Espadrilles / wedges", kind: "espadrilles", category: "shoes", climate: "warm" },
  { id: "w-heeled-sandals", label: "Heeled sandals", kind: "heeled-sandals", category: "shoes", climate: "any" },
  { id: "w-sneakers", label: "Sneakers", kind: "sneakers", category: "shoes", climate: "any" },
  // Bags
  { id: "w-straw-tote", label: "Straw tote", kind: "straw-tote", category: "bags", climate: "warm" },
  { id: "w-crossbody", label: "Crossbody bag", kind: "crossbody", category: "bags", climate: "any" },
  { id: "w-clutch", label: "Evening clutch", kind: "clutch", category: "bags", climate: "any" },
  // Accessories
  { id: "w-sunglasses", label: "Sunglasses", kind: "sunglasses", category: "accessories", climate: "warm" },
  { id: "w-sun-hat", label: "Sun hat", kind: "sun-hat", category: "accessories", climate: "warm" },
  { id: "w-scarf", label: "Scarf", kind: "scarf", category: "accessories", climate: "any" },
  { id: "w-earrings", label: "Statement earrings", kind: "earrings", category: "accessories", climate: "any" },
];

// Card background per category for the closet swipe (no product images for
// archetypes, so the category colour carries the visual).
const CLOSET_COLORS = {
  tops: "#C4A5A0", knitwear: "#C79A44", outerwear: "#5B6B8C", bottoms: "#3E4A3D",
  dresses: "#B85C38", shoes: "#8C6A5B", swimwear: "#74856A", accessories: "#A8785B", bags: "#6B5B7A",
};

// A closet piece is an archetype ("Jeans") by default, but it can optionally be
// linked to a real product so the closet shows an actual photo and a buy link
// that earns commission when someone shops it from a public closet. The link is
// a lightweight snapshot of the feed/catalog item — crucially it carries
// `sourceUrl`, the tracked affiliate deep link, when one exists. Until the
// product feed is populated, catalog stand-ins have no sourceUrl and buyLinkFor
// degrades to a retailer search, so the UI works now and monetises later.
function productRefFrom(item) {
  if (!item) return null;
  return {
    title: item.title,
    store: item.store,
    price: item.price,
    color: item.color,
    kind: item.kind || null,
    imageUrl: item.imageUrl || null,
    sourceUrl: item.sourceUrl || null,
  };
}

// The visual colour for a piece: the linked product's colour if it has one,
// otherwise the category swatch.
function pieceColor(w) {
  return (w.product && w.product.color) || CLOSET_COLORS[w.category] || "#8A8172";
}

function requiredClimateFor(item) {
  // Items declare their own climate now; fall back to a category default.
  if (item.climate) return item.climate;
  switch (item.category) {
    case "tops": return "warm";
    case "knitwear": return "cool";
    case "outerwear": return "cool";
    case "swimwear": return "water";
    default: return "any";
  }
}

function pieceSuits(piece, climate) {
  return climate === "any" || piece.climate === "any" || piece.climate === climate;
}

function closetMatchesFor(item, wardrobe) {
  if (!item.category) return [];
  const climate = requiredClimateFor(item);
  // Match on the fine-grained kind when both sides declare one, so an owned belt
  // doesn't get counted as owning sunglasses just because both are "accessories".
  // Fall back to category only when kind data is missing.
  return wardrobe.filter((w) => {
    if (!pieceSuits(w, climate)) return false;
    if (item.kind && w.kind) return w.kind === item.kind;
    return w.category === item.category;
  });
}

// Swipe through the wardrobe archetypes: right for what you own, left to skip.
// A stepper on each card captures how many, which is what lets packing show a
// shortfall ("you own 1 of 4") and turn it into a buy-now recommendation.
function ClosetSetup({ wardrobe, onSave, onClose }) {
  const deck = WARDROBE_ARCHETYPES;
  const [index, setIndex] = useState(0);
  const [counts, setCounts] = useState(() => {
    const m = {};
    wardrobe.forEach((w) => { m[w.id] = w.qty; });
    return m;
  });
  const [pending, setPending] = useState(1); // qty chosen on the current card
  const [history, setHistory] = useState([]);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [exiting, setExiting] = useState(null); // 'own' | 'skip'
  const startX = useRef(0);

  const current = deck[index];
  const done = index >= deck.length;
  const ownedTypes = Object.values(counts).filter((n) => n > 0).length;

  // Each new card starts at the count you'd already set, or 1.
  useEffect(() => {
    if (!current) return;
    setPending(counts[current.id] ? counts[current.id] : 1);
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = useCallback((own) => {
    if (!current || exiting) return;
    setExiting(own ? "own" : "skip");
    setTimeout(() => {
      setCounts((c) => {
        const n = { ...c };
        if (own) n[current.id] = pending;
        else delete n[current.id];
        return n;
      });
      setHistory((h) => [...h, current.id]);
      setIndex((i) => i + 1);
      setDragX(0);
      setExiting(null);
    }, 200);
  }, [current, exiting, pending]);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    setHistory((h) => h.slice(0, -1));
    setIndex((i) => Math.max(0, i - 1));
    setDragX(0);
  }, [history]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowRight") commit(true);
      if (e.key === "ArrowLeft") commit(false);
      if (e.key.toLowerCase() === "z") undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit, undo]);

  const onPointerDown = (e) => { if (!current || exiting) return; setDragging(true); startX.current = e.clientX; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const onPointerMove = (e) => { if (!dragging) return; setDragX(e.clientX - startX.current); };
  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    if (dragX > 100) commit(true);
    else if (dragX < -100) commit(false);
    else setDragX(0);
  };

  const save = () => {
    onSave(WARDROBE_ARCHETYPES.filter((a) => counts[a.id] > 0).map((a) => ({ ...a, qty: counts[a.id] })));
    onClose();
  };

  const offset = exiting === "own" ? 460 : exiting === "skip" ? -460 : dragX;
  const rotation = offset / 24;
  const ownOpacity = Math.max(0, Math.min(1, offset / 100));
  const skipOpacity = Math.max(0, Math.min(1, -offset / 100));
  const cardColor = current ? (CLOSET_COLORS[current.category] || "#8A8172") : "#8A8172";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(33,29,24,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#EDE7DD", borderRadius: 16, padding: "18px 20px 22px", width: 400, maxWidth: "100%", maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 30px 60px -20px rgba(33,29,24,0.45)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 2 }}>
          <div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "#74856A" }}>build your closet</div>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 500, margin: "2px 0 0" }}>What do you own?</h2>
          </div>
          <button className="focus-ring" onClick={onClose} style={{ background: "none", border: "none", marginTop: 2 }}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 11.5, color: "#8A8172", margin: "6px 0 14px", lineHeight: 1.5 }}>
          Swipe right for what you already own, left for what you don't. Set how many of each, so every trip can tell you what you still need to buy.
        </p>

        {done ? (
          <div style={{ textAlign: "center", padding: "24px 8px" }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, marginBottom: 6 }}>Closet ready</div>
            <p style={{ fontSize: 13, color: "#8A8172", margin: "0 0 20px", lineHeight: 1.5 }}>
              You added {ownedTypes} {ownedTypes === 1 ? "type" : "types"} of clothing. Every trip now shows what to pack and what to buy.
            </p>
            <button className="focus-ring" onClick={save} style={{ width: "100%", background: "#211D18", color: "#EDE7DD", border: "none", borderRadius: 999, padding: "13px 0", fontSize: 14, fontWeight: 500 }}>
              Save closet ({ownedTypes})
            </button>
            <button className="focus-ring" onClick={() => { setIndex(0); setHistory([]); }} style={{ marginTop: 10, background: "none", border: "1px solid #D8D0C0", borderRadius: 999, padding: "10px 0", width: "100%", fontSize: 13 }}>
              Go through again
            </button>
          </div>
        ) : (
          <>
            <div style={{ position: "relative", width: "100%", height: 300, marginBottom: 16 }}>
              <div
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                style={{ position: "absolute", inset: 0, transform: `translateX(${offset}px) rotate(${rotation}deg)`, transition: dragging ? "none" : "transform 0.2s ease", cursor: dragging ? "grabbing" : "grab", touchAction: "none" }}
              >
                <div style={{ width: "100%", height: "100%", borderRadius: 16, overflow: "hidden", position: "relative", boxShadow: "0 14px 30px -14px rgba(33,29,24,0.4)", background: "#F7F3EA", display: "flex", flexDirection: "column", userSelect: "none" }}>
                  {/* Product photo (or line-art icon fallback) fills the card above
                      the info panel, so the swipe deck previews the actual item. */}
                  <div style={{ flex: 1, minHeight: 0, position: "relative", pointerEvents: "none", background: "#EDE9E2" }}>
                    <ProductVisual color={cardColor} kind={current.kind} height="100%" radius={0} fit="contain" />
                  </div>
                  <div style={{ position: "absolute", top: 16, left: 16, opacity: ownOpacity, pointerEvents: "none" }}>
                    <span style={{ border: "2.5px solid #F7F3EA", color: "#F7F3EA", padding: "5px 12px", borderRadius: 8, fontFamily: FONT_MONO, fontSize: 14, fontWeight: 600, letterSpacing: "0.08em", transform: "rotate(-12deg)", display: "inline-block", background: "rgba(33,29,24,0.28)" }}>I OWN</span>
                  </div>
                  <div style={{ position: "absolute", top: 16, right: 16, opacity: skipOpacity, pointerEvents: "none" }}>
                    <span style={{ border: "2.5px solid #F7F3EA", color: "#F7F3EA", padding: "5px 12px", borderRadius: 8, fontFamily: FONT_MONO, fontSize: 14, fontWeight: 600, letterSpacing: "0.08em", transform: "rotate(12deg)", display: "inline-block", background: "rgba(33,29,24,0.28)" }}>SKIP</span>
                  </div>
                  <div style={{ background: "rgba(247,243,234,0.94)", padding: "16px 18px", borderTop: "1px solid rgba(33,29,24,0.06)" }}>
                    <div style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "#74856A" }}>{current.category}</div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 500, margin: "2px 0 12px" }}>{current.label}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 12, color: "#8A8172" }}>How many do you own?</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button className="focus-ring" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPending((p) => Math.max(1, p - 1)); }} style={{ width: 26, height: 26, borderRadius: "50%", border: "1px solid #C9BFA9", background: "#fff", fontSize: 15, lineHeight: 1, padding: 0 }}>−</button>
                        <span style={{ fontFamily: FONT_MONO, fontSize: 15, minWidth: 20, textAlign: "center" }}>{pending}</span>
                        <button className="focus-ring" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPending((p) => Math.min(15, p + 1)); }} style={{ width: 26, height: 26, borderRadius: "50%", border: "1px solid #C9BFA9", background: "#fff", fontSize: 15, lineHeight: 1, padding: 0 }}>+</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 12 }}>
              <button aria-label="Skip" className="focus-ring" onClick={() => commit(false)} style={{ width: 52, height: 52, borderRadius: "50%", border: "1px solid #D8D0C0", background: "#F7F3EA", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <X size={22} color="#8A8172" />
              </button>
              <button aria-label="Undo" className="focus-ring" onClick={undo} disabled={history.length === 0} style={{ width: 40, height: 40, borderRadius: "50%", border: "1px solid #D8D0C0", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", opacity: history.length === 0 ? 0.35 : 1 }}>
                <RotateCcw size={16} color="#211D18" />
              </button>
              <button aria-label="I own this" className="focus-ring" onClick={() => commit(true)} style={{ width: 52, height: 52, borderRadius: "50%", border: "none", background: "#74856A", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 14px -6px rgba(116,133,106,0.6)" }}>
                <Check size={22} color="#F7F3EA" />
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: "#8A8172" }}>{index + 1} / {deck.length} · {ownedTypes} owned</span>
              <button className="focus-ring" onClick={save} style={{ background: "none", border: "1px solid #C9BFA9", borderRadius: 999, padding: "6px 14px", fontSize: 12, color: "#211D18" }}>
                Save closet
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Order categories consistently wherever the closet is listed, so the same
// piece always lives in the same place.
const CLOSET_CATEGORY_ORDER = ["tops", "knitwear", "outerwear", "bottoms", "dresses", "shoes", "swimwear", "accessories", "bags"];

// The saved closet, shown once the user has set one up. The swipe deck is great
// for the initial pass, but afterwards people want to see everything they told
// us they own at a glance and nudge a quantity or drop an item — without
// re-swiping the whole deck. Edits write straight back through onSave so they
// persist immediately. "Add or edit more" reopens the swipe deck for a fuller pass.
function ClosetView({ wardrobe, onSave, onClose, onAddMore, products = CATALOG }) {
  const totalPieces = wardrobe.reduce((s, w) => s + (w.qty || 0), 0);
  const setQty = (id, n) => onSave(wardrobe.map((w) => (w.id === id ? { ...w, qty: Math.max(1, n) } : w)));
  const remove = (id) => onSave(wardrobe.filter((w) => w.id !== id));

  // Product linking: attach a real product to an owned piece so the closet
  // shows a photo and a buy link. `linking` holds the id of the piece whose
  // product picker is open. The picker is fed from `products` (the live feed
  // once it exists; the seed catalog as a stand-in for now), filtered to the
  // same category so suggestions stay relevant.
  const [linking, setLinking] = useState(null);
  const attach = (id, product) => { onSave(wardrobe.map((w) => (w.id === id ? { ...w, product } : w))); setLinking(null); };
  const unlink = (id) => onSave(wardrobe.map((w) => { if (w.id !== id) return w; const { product, ...rest } = w; return rest; }));

  const grouped = CLOSET_CATEGORY_ORDER
    .map((cat) => ({ cat, items: wardrobe.filter((w) => w.category === cat) }))
    .filter((g) => g.items.length > 0);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(33,29,24,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#EDE7DD", borderRadius: 16, padding: "20px 22px 22px", width: 440, maxWidth: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 30px 60px -20px rgba(33,29,24,0.45)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 2 }}>
          <div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "#74856A" }}>your closet</div>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 500, margin: "2px 0 0" }}>What you own</h2>
          </div>
          <button className="focus-ring" onClick={onClose} style={{ background: "none", border: "none", marginTop: 2 }}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 11.5, color: "#8A8172", margin: "6px 0 14px", lineHeight: 1.5 }}>
          {wardrobe.length} {wardrobe.length === 1 ? "type" : "types"} · {totalPieces} {totalPieces === 1 ? "piece" : "pieces"}. Adjust a count, remove anything that's changed, or link a real product to show a photo and a shoppable link on your closet.
        </p>

        {wardrobe.length === 0 ? (
          <div style={{ border: "1.5px dashed #C9BFA9", borderRadius: 12, padding: "34px 20px", textAlign: "center", color: "#8A8172", fontSize: 13, marginBottom: 14 }}>
            Your closet is empty. Add what you own so trips can tell you what you're missing.
          </div>
        ) : (
          <div style={{ overflowY: "auto", flex: 1, marginBottom: 14 }}>
            {grouped.map((g) => (
              <div key={g.cat} style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "#74856A", marginBottom: 6 }}>{g.cat}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {g.items.map((w) => {
                    const picks = products.filter((p) => p.category === w.category);
                    return (
                    <div key={w.id} style={{ background: "#F7F3EA", border: "1px solid #E4DDCE", borderRadius: 10, padding: "9px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 7, flexShrink: 0, overflow: "hidden" }}>
                          <ProductVisual color={pieceColor(w)} kind={w.kind} height={34} radius={7} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 500 }}>{w.label}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                          <button aria-label={`Fewer ${w.label}`} className="focus-ring" onClick={() => setQty(w.id, (w.qty || 1) - 1)} disabled={(w.qty || 1) <= 1} style={{ width: 24, height: 24, borderRadius: "50%", border: "1px solid #C9BFA9", background: "#fff", color: "#74856A", fontSize: 14, lineHeight: 1, padding: 0, opacity: (w.qty || 1) <= 1 ? 0.4 : 1 }}>−</button>
                          <span style={{ fontFamily: FONT_MONO, fontSize: 13, minWidth: 20, textAlign: "center" }}>{w.qty || 1}</span>
                          <button aria-label={`More ${w.label}`} className="focus-ring" onClick={() => setQty(w.id, (w.qty || 1) + 1)} style={{ width: 24, height: 24, borderRadius: "50%", border: "1px solid #C9BFA9", background: "#fff", color: "#74856A", fontSize: 14, lineHeight: 1, padding: 0 }}>+</button>
                        </div>
                        <button aria-label={`Remove ${w.label}`} className="focus-ring" onClick={() => remove(w.id)} style={{ background: "none", border: "none", color: "#B85C38", flexShrink: 0, padding: 4, display: "flex" }}><X size={14} /></button>
                      </div>

                      {/* Linked product row / link affordance */}
                      {w.product ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, paddingTop: 8, borderTop: "1px dashed #D8D0C0" }}>
                          <ProductVisual imageUrl={w.product.imageUrl} color={w.product.color} kind={w.product.kind || w.kind} height={30} radius={5} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.product.title}</div>
                            <div style={{ fontSize: 10.5, color: "#8A8172" }}>{w.product.store}{w.product.sourceUrl ? " · earns commission" : " · search link"}</div>
                          </div>
                          <button className="focus-ring" onClick={() => setLinking(linking === w.id ? null : w.id)} style={{ background: "none", border: "1px solid #C9BFA9", borderRadius: 999, padding: "4px 10px", fontSize: 11, color: "#211D18", flexShrink: 0 }}>Change</button>
                          <button aria-label="Unlink product" className="focus-ring" onClick={() => unlink(w.id)} style={{ background: "none", border: "none", color: "#8A8172", flexShrink: 0, padding: 4, display: "flex" }}><X size={13} /></button>
                        </div>
                      ) : (
                        <button className="focus-ring" onClick={() => setLinking(linking === w.id ? null : w.id)} style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 7, background: "none", border: "none", color: "#74856A", fontSize: 11.5, padding: 0 }}>
                          <Plus size={12} /> Link a product
                        </button>
                      )}

                      {/* Product picker */}
                      {linking === w.id && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #D8D0C0" }}>
                          {picks.length === 0 ? (
                            <div style={{ fontSize: 11.5, color: "#8A8172" }}>No products for {w.category} yet. They'll appear here once your feed is populated.</div>
                          ) : (
                            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                              {picks.map((p) => (
                                <button key={p.id} className="focus-ring" onClick={() => attach(w.id, productRefFrom(p))} style={{ flexShrink: 0, width: 84, background: "#fff", border: "1px solid #E4DDCE", borderRadius: 9, padding: 0, overflow: "hidden", textAlign: "left", cursor: "pointer" }}>
                                  <ProductVisual imageUrl={p.imageUrl} color={p.color} kind={p.kind} height={72} radius={0} />
                                  <div style={{ padding: "5px 6px 6px" }}>
                                    <div style={{ fontSize: 10.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title}</div>
                                    <div style={{ fontSize: 9.5, color: "#8A8172" }}>{p.store}</div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button className="focus-ring" onClick={onAddMore} style={{ flex: 1, background: "none", border: "1px solid #C9BFA9", borderRadius: 999, padding: "11px 0", fontSize: 13, color: "#211D18", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Plus size={14} /> Add or edit more
          </button>
          <button className="focus-ring" onClick={onClose} style={{ flex: 1, background: "#211D18", color: "#EDE7DD", border: "none", borderRadius: 999, padding: "11px 0", fontSize: 13, fontWeight: 500 }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// Trip persistence. The whole point of signing in is that your trip is still
// there when you come back — dates, countries, stops, what you've packed, and
// your closet. We keep it in one localStorage blob, versioned so the shape can
// change later without choking on stale data. Bumping TRIP_STORE_VERSION
// invalidates old saves cleanly.
const TRIP_STORE_KEY = "fly_trip_v1";
const TRIP_STORE_VERSION = 1;

function loadSavedTrip() {
  try {
    const raw = localStorage.getItem(TRIP_STORE_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (!t || typeof t !== "object" || t.v !== TRIP_STORE_VERSION) return null;
    // Overlay current field definitions (labels, category, `kind`, climate…)
    // onto the saved rows, keeping only the user's packed state. This is what
    // lets an older saved trip pick up the fine-grained `kind` used for shop
    // matching instead of staying frozen at its original shape.
    t.suggested = rehydrateById(t.suggested, STARTER_SUGGESTED, ["packed"]);
    t.other = mergeEssentials(t.other, STARTER_OTHER);
    return t;
  } catch { return null; }
}

function clearSavedTrip() {
  try { localStorage.removeItem(TRIP_STORE_KEY); } catch {}
}

// Re-hydrate persisted rows against their canonical code definitions. A saved
// trip or closet only needs to preserve what the *user* changed — whether an
// item is packed, how many they own, any product they linked. Every other field
// (label, category, and especially the newer `kind` the shop picker matches on)
// should come from code, so taxonomy changes reach trips that were saved before
// those fields existed. Without this, a trip saved before `kind` was added keeps
// serving kind-less rows forever, and "Shop → Sun hat" falls back to the whole
// "accessories" category (returning belts and sunglasses). Rows with no
// canonical match — custom items the user added themselves — pass through intact.
function rehydrateById(savedRows, canonical, keepFields) {
  if (!Array.isArray(savedRows)) return canonical;
  const byId = new Map(canonical.map((c) => [c.id, c]));
  return savedRows.map((row) => {
    const base = byId.get(row.id);
    if (!base) return row; // user-added custom item — leave as-is
    const merged = { ...base };
    keepFields.forEach((k) => { if (row[k] !== undefined) merged[k] = row[k]; });
    return merged;
  });
}

// The "everything else" list is code-owned but a superset that grows over time,
// so unlike rehydrateById it UNIONS: every canonical essential always appears
// (a trip saved before the essentials rework still gains them), carrying over
// only the user's packed state, and any custom items they added are kept. The
// four legacy starter ids (o1–o4) are dropped since the grouped catalog now
// supersedes them.
function mergeEssentials(savedRows, canonical) {
  if (!Array.isArray(savedRows)) return canonical;
  const savedById = new Map(savedRows.map((r) => [r.id, r]));
  const base = canonical.map((c) => {
    const s = savedById.get(c.id);
    return s && s.packed !== undefined ? { ...c, packed: s.packed } : c;
  });
  const canonicalIds = new Set(canonical.map((c) => c.id));
  const customs = savedRows.filter((r) => !canonicalIds.has(r.id) && !/^o\d+$/.test(String(r.id)));
  return [...base, ...customs];
}

function TripPlannerScreen({ pins, wardrobe, setWardrobe, onSaveTrip }) {
  // First-time vs returning. A first-timer sees a fully worked sample trip
  // (Italy) plus a short "how to plan" banner, so nothing is ever an empty
  // page you have to figure out. Once they've planned once, that flag flips and
  // they land on a clean "start a new trip" canvas instead of the sample.
  const isReturning = (() => {
    try { return localStorage.getItem("fly_onboarded") === "1"; } catch { return false; }
  })();
  const markOnboarded = useCallback(() => {
    try { localStorage.setItem("fly_onboarded", "1"); } catch {}
  }, []);

  // A previously saved trip always wins over the first-time sample / empty
  // canvas — that's what "resume where you left off" means. Read once on mount.
  const saved = useMemo(loadSavedTrip, []);

  const [countries, setCountries] = useState(saved?.countries ?? (isReturning ? [] : STARTER_COUNTRIES));
  const [startDate, setStartDate] = useState(saved?.startDate ?? DEMO_START);
  const [endDate, setEndDate] = useState(saved?.endDate ?? DEMO_END);
  const [legs, setLegs] = useState(saved?.legs ?? (isReturning ? [] : STARTER_LEGS));
  // The "how to plan your trip" banner — only for a genuine first-timer with
  // no saved trip; dismissable.
  const [showGuide, setShowGuide] = useState(!isReturning && !saved);
  // Which stop's forecast is showing. This only drives the weather panel — the
  // packing list below is one master list for the whole trip and never changes
  // with the active stop.
  const [activeKey, setActiveKey] = useState(null); // 'leg:<id>' | 'country:<id>'

  const [suggested, setSuggested] = useState(saved?.suggested ?? STARTER_SUGGESTED);
  const [other, setOther] = useState(saved?.other ?? STARTER_OTHER);
  // If this trip was reopened from the "You" tab it carries the id of its saved
  // card, so re-saving updates that same card rather than making a new one.
  const [savedTripId, setSavedTripId] = useState(saved?.savedTripId ?? null);
  const [justSaved, setJustSaved] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  // "Everything else" is collapsed by default so it never competes with the
  // core clothing packing list.
  const [showEssentials, setShowEssentials] = useState(false);
  const [shopItem, setShopItem] = useState(null);
  const [showItinerary, setShowItinerary] = useState(false);
  // wardrobe / setWardrobe now come from App root — the closet is shared across
  // every trip and the profile, not owned by this screen.
  const [showCloset, setShowCloset] = useState(false); // the swipe-deck setup
  const [showClosetView, setShowClosetView] = useState(false); // the saved-closet summary

  // One entry point for the closet button: if there's already a closet, open
  // the summary view to review/tweak; otherwise drop into the swipe deck to
  // build one from scratch.
  const openCloset = useCallback(() => {
    if (wardrobe.length > 0) setShowClosetView(true);
    else setShowCloset(true);
  }, [wardrobe.length]);

  const [countryQuery, setCountryQuery] = useState("");
  const [showCountryField, setShowCountryField] = useState(false);
  // Which country's stop field is open, and what's typed in it. Keyed by
  // country id so each card has its own field — a single shared one made it
  // ambiguous which country you were adding to.
  const [openStopFor, setOpenStopFor] = useState(null);
  const [stopQuery, setStopQuery] = useState("");
  const [weather, setWeather] = useState({});

  const tripDays = Math.max(1, daysBetween(startDate, endDate));

  // Countries default to an even split of the trip. Recalculated when the trip
  // length or the country list changes, unless the user has set nights manually.
  const [manualSplit, setManualSplit] = useState(saved?.manualSplit ?? false);
  useEffect(() => {
    if (manualSplit || countries.length === 0) return;
    const split = evenSplit(tripDays, countries.length);
    setCountries((cs) => cs.map((c, i) => ({ ...c, nights: split[i] })));
  }, [tripDays, countries.length, manualSplit]);

  // Persist the trip whenever anything meaningful changes, so it survives a
  // refresh or a return visit. Kept to the durable fields only — transient UI
  // state (open modals, query text, fetched weather) is deliberately excluded.
  useEffect(() => {
    try {
      localStorage.setItem(
        TRIP_STORE_KEY,
        JSON.stringify({ v: TRIP_STORE_VERSION, startDate, endDate, countries, legs, suggested, other, manualSplit, savedTripId })
      );
    } catch {}
  }, [startDate, endDate, countries, legs, suggested, other, manualSplit, savedTripId]);

  // Clear the sample and drop straight into the trip editor on a blank canvas.
  // Also marks the user as onboarded so future visits open clean by default.
  const startFreshTrip = useCallback(() => {
    setCountries([]);
    setLegs([]);
    setManualSplit(false);
    setShowGuide(false);
    // Reset the packing checklist to a clean slate (nothing packed). The closet
    // is intentionally left alone — it's what you own, not part of any one trip.
    setSuggested(STARTER_SUGGESTED);
    setOther(STARTER_OTHER);
    setSavedTripId(null); // a fresh trip is a new "You" card, not an update
    clearSavedTrip();
    markOnboarded();
    setShowItinerary(true);
  }, [markOnboarded]);

  // The trip timeline: walk countries in order; within each, use its stops if
  // there are any, otherwise the country itself as one approximate block.
  const timeline = useMemo(() => {
    const out = [];
    let cursor = startDate;
    for (const c of countries) {
      const stops = legs.filter((l) => l.country === c.name);
      if (stops.length > 0) {
        for (const s of stops) {
          const n = Math.max(1, s.nights || 1);
          out.push({
            key: `leg:${s.id}`,
            kind: "stop",
            id: s.id,
            label: s.city,
            country: c.name,
            lat: s.lat,
            lon: s.lon,
            coastal: s.coastal,
            nights: n,
            start: cursor,
            end: addDays(cursor, n - 1),
            approximate: false,
          });
          cursor = addDays(cursor, n);
        }
      } else {
        const n = Math.max(1, c.nights || 1);
        out.push({
          key: `country:${c.id}`,
          kind: "country",
          id: c.id,
          label: c.name,
          country: c.name,
          lat: c.lat,
          lon: c.lon,
          coastal: false,
          nights: n,
          start: cursor,
          end: addDays(cursor, n - 1),
          approximate: true,
        });
        cursor = addDays(cursor, n);
      }
    }
    return out;
  }, [countries, legs, startDate]);

  // Reads a stop's weather out of the whole-trip cache (fetched by the effect
  // below): undefined until its request starts, then "loading" | "error" | { days, source }.
  const segWeather = (t) => weather[`${t.key}:${t.start}:${t.end}`];

  // Keep the active stop valid as the timeline changes. The tabs let you flip
  // between stops to check each forecast; they don't touch the packing list.
  useEffect(() => {
    if (timeline.length === 0) { setActiveKey(null); return; }
    if (!activeKey || !timeline.some((t) => t.key === activeKey)) setActiveKey(timeline[0].key);
  }, [timeline, activeKey]);
  const active = timeline.find((t) => t.key === activeKey) || timeline[0] || null;
  const current = active ? segWeather(active) : undefined;
  const weatherDays = current && current !== "loading" && current !== "error" ? current.days : [];

  // Packing reads the WHOLE trip, not just one stop — you pack once.
  const allWeatherKeys = useMemo(
    () => timeline.map((t) => `${t.key}:${t.start}:${t.end}`),
    [timeline]
  );
  const conditions = useMemo(() => {
    const days = allWeatherKeys.flatMap((k) => {
      const w = weather[k];
      return w && w !== "loading" && w !== "error" ? w.days : [];
    });
    if (days.length === 0) return null;
    const his = days.map((d) => d.hi);
    const los = days.map((d) => d.lo);
    return {
      maxHi: Math.max(...his),
      minLo: Math.min(...los),
      avgHi: Math.round(his.reduce((a, b) => a + b, 0) / his.length),
      rainDays: days.filter((d) => d.icon === "rain").length,
      sunDays: days.filter((d) => d.icon === "sun").length,
    };
  }, [allWeatherKeys, weather]);

  // Fetch every segment's weather (not just the visible one) so packing sees
  // the whole trip. Sequential-ish via the cache; each key fetches once.
  useEffect(() => {
    timeline.forEach((t) => {
      const k = `${t.key}:${t.start}:${t.end}`;
      if (weather[k] || t.lat == null) return;
      setWeather((w) => ({ ...w, [k]: "loading" }));
      fetchWeather(t.lat, t.lon, t.start, t.end)
        .then((d) => setWeather((w) => ({ ...w, [k]: d })))
        .catch(() => setWeather((w) => ({ ...w, [k]: "error" })));
    });
  }, [timeline]);

  const toggleSuggested = (id) => setSuggested((s) => s.map((i) => (i.id === id ? { ...i, packed: !i.packed } : i)));
  const toggleOther = (id) => setOther((s) => s.map((i) => (i.id === id ? { ...i, packed: !i.packed } : i)));

  // Location-relevant "everything else": the adapter row adapts to the trip's
  // countries, and each essential is gated on the real forecast, coast and trip
  // length — so the tally and the list only ever reflect what's actually shown.
  const coastalDays = legs.filter((l) => l.coastal).reduce((s, l) => s + (l.nights || 0), 0);
  const adapterInfo = adapterEssentialFor(countries);
  const visibleSuggested = suggested.filter((it) => recommendFor(it, conditions, legs, tripDays).show);
  const visibleOther = other.filter((it) => (it.group ? essentialShows(it, conditions, coastalDays, tripDays) : true));
  const essentialItems = visibleOther.filter((i) => i.group);
  const customItems = visibleOther.filter((i) => !i.group);
  const essentialsPacked = visibleOther.filter((i) => i.packed).length;
  const allItems = [...visibleSuggested, ...visibleOther];
  const packedCount = allItems.filter((i) => i.packed).length;

  const addOther = () => {
    if (!newItem.trim()) return;
    setOther((o) => [...o, { id: `custom-${Date.now()}`, label: newItem.trim(), packed: false, category: null }]);
    setNewItem("");
    setShowAdd(false);
  };

  const addCountry = (place) => {
    const name = place.country || place.name;
    if (!name) { setCountryQuery(""); return; }
    const existing = countries.find((c) => c.name === name);
    if (existing) {
      // Already on the trip — just open its stop field rather than silently
      // doing nothing.
      setOpenStopFor(existing.id);
      setCountryQuery("");
      return;
    }
    const id = `c-${Date.now()}`;
    setCountries((cs) => [...cs, { id, name, label: name, countryCode: place.countryCode, lat: place.lat, lon: place.lon, nights: 0 }]);
    setManualSplit(false); // re-split evenly to include the new country
    setCountryQuery("");
    setOpenStopFor(id); // prompt for a stop straight away; skippable
    setStopQuery("");
  };

  // Adds a stop to a specific country. The country is known from which card's
  // field was used, so there's no guessing from the search result.
  const addStopToCountry = (countryId, place) => {
    const c = countries.find((x) => x.id === countryId);
    if (!c) return;
    setLegs((ls) => [...ls, {
      id: `leg-${Date.now()}`,
      city: place.name,
      label: place.label,
      country: c.name,
      lat: place.lat,
      lon: place.lon,
      nights: 2,
      coastal: !!place.coastal,
    }]);
    setStopQuery(""); // stay open so they can add another
  };
  const removeCountry = (id) => {
    const c = countries.find((x) => x.id === id);
    setCountries((cs) => cs.filter((x) => x.id !== id));
    if (c) setLegs((ls) => ls.filter((l) => l.country !== c.name)); // its stops go too
    setManualSplit(false);
  };
  const setCountryNights = (id, n) => {
    setManualSplit(true);
    setCountries((cs) => cs.map((c) => (c.id === id ? { ...c, nights: Math.max(0, n) } : c)));
  };
  const moveCountry = (id, dir) => {
    setCountries((cs) => {
      const i = cs.findIndex((c) => c.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= cs.length) return cs;
      const copy = [...cs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  };

  const updateLegNights = (id, nights) => setLegs((ls) => ls.map((l) => (l.id === id ? { ...l, nights: Math.max(1, nights) } : l)));
  const removeLeg = (id) => setLegs((ls) => ls.filter((l) => l.id !== id));
  const moveLeg = (id, dir) => {
    setLegs((ls) => {
      const i = ls.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ls.length) return ls;
      const copy = [...ls];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  };
  // A stop knows its country from the API. If that country isn't on the trip
  // yet, add it — otherwise the stop would be orphaned off the timeline.
  // ISO codes of the trip's countries — cities there rank first when searching.
  const countryBias = useMemo(
    () => countries.map((c) => c.countryCode).filter(Boolean),
    [countries]
  );

  const shopMatches = useMemo(() => (shopItem ? shopMatchesFor(shopItem, pins) : []), [shopItem, pins]);

  const tripTitle = countries.length === 0
    ? "Your trip"
    : countries.length === 1
    ? countries[0].name
    : countries.length === 2
    ? `${countries[0].name} & ${countries[1].name}`
    : `${countries.slice(0, -1).map((c) => c.name).join(", ")} & ${countries[countries.length - 1].name}`;

  const assignedNights = timeline.reduce((s, t) => s + t.nights, 0);
  const unassigned = tripDays - assignedNights;

  // Snapshot the current trip and hand it up to be stored on the "You" tab. We
  // keep both a display layer (title/cities/duration/cover for the trip card)
  // and a `trip` payload (the durable planner fields) so the trip can be
  // reopened and resumed. A deterministic cover gradient is picked from the
  // brand palette off the title so a given trip always looks the same.
  const handleSaveTrip = useCallback(() => {
    const id = savedTripId || `t-${Date.now().toString(36)}`;
    if (!savedTripId) setSavedTripId(id);
    const covers = [
      ["#C4A5A0", "#8C6A5B"], ["#A7B49E", "#74856A"], ["#A9C3D6", "#5B6B8C"],
      ["#E9D98A", "#C9A227"], ["#E8896B", "#C0392B"], ["#D9B8B0", "#B85C38"],
      ["#4FB0A5", "#2E3A52"],
    ];
    let h = 0;
    for (let i = 0; i < tripTitle.length; i++) h = (h * 31 + tripTitle.charCodeAt(i)) >>> 0;
    const snap = {
      id,
      title: tripTitle,
      cities: timeline.map((t) => t.label),
      duration: `${tripDays} ${tripDays === 1 ? "day" : "days"}`,
      dates: `${prettyDate(startDate)} – ${prettyDate(endDate)}`,
      cover: covers[h % covers.length],
      likes: 0,
      tagged: false,
      savedAt: Date.now(),
      trip: { startDate, endDate, countries, legs, suggested, other, manualSplit },
    };
    onSaveTrip && onSaveTrip(snap);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2200);
  }, [savedTripId, tripTitle, timeline, tripDays, startDate, endDate, countries, legs, suggested, other, manualSplit, onSaveTrip]);

  return (
    <div>
      <header style={{ padding: "28px 32px 20px", borderBottom: "1px solid #D8D0C0" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.14em", color: "#74856A", textTransform: "uppercase", marginBottom: 4 }}>
              <span>
                {prettyDate(startDate)} – {prettyDate(endDate)} · {tripDays} {tripDays === 1 ? "day" : "days"}
                {legs.length > 0 && ` · ${legs.length} ${legs.length === 1 ? "stop" : "stops"}`}
              </span>
              <button className="focus-ring" onClick={() => setShowItinerary(true)} style={{ background: "none", border: "1px solid #C9BFA9", borderRadius: 999, padding: "3px 10px", fontSize: 10.5, color: "#74856A", letterSpacing: "0.05em" }}>
                edit trip
              </button>
            </div>
            <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 500, fontSize: 34, margin: 0, letterSpacing: "-0.01em" }}>
              {tripTitle}
            </h1>
          </div>
          {timeline.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}>
              <button
                className="focus-ring"
                onClick={handleSaveTrip}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  background: justSaved ? "#74856A" : "#211D18",
                  color: "#EDE7DD",
                  border: "none",
                  borderRadius: 999,
                  padding: "9px 16px",
                  fontSize: 12.5,
                  fontWeight: 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {justSaved ? <><Check size={13} /> Saved to You</> : <><Luggage size={13} /> {savedTripId ? "Update saved trip" : "Save trip"}</>}
              </button>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: FONT_MONO, fontSize: 22, fontWeight: 500 }}>{packedCount}<span style={{ color: "#8A8172" }}>/{allItems.length}</span></div>
                <div style={{ fontSize: 11, color: "#8A8172" }}>packed</div>
              </div>
            </div>
          )}
        </div>

        {timeline.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 11 }}>
              <CloudSun size={14} color="#74856A" />
              <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#74856A" }}>forecast by stop</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {timeline.map((t) => (
                <button key={t.key} className="nav-tab focus-ring" onClick={() => setActiveKey(t.key)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 999, border: "1px solid " + (activeKey === t.key ? "#211D18" : "#D8D0C0"), background: activeKey === t.key ? "#211D18" : "transparent", color: activeKey === t.key ? "#EDE7DD" : "#211D18", fontSize: 13 }}>
                  <MapPin size={12} />
                  {t.label}
                  {t.approximate && <span style={{ fontSize: 9, opacity: 0.7 }}>~</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      <div style={{ padding: "26px 32px 60px", maxWidth: 820 }}>
        {timeline.length === 0 ? (
          /* Returning-user default: a clean canvas, no sample trip. */
          <div style={{ padding: "24px 0 20px" }}>
            <div style={{ border: "1.5px dashed #C9BFA9", background: "#F7F3EA", borderRadius: 18, padding: "52px 28px", textAlign: "center" }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: "#EFE7D8", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
                <Plane size={24} color="#74856A" />
              </div>
              <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 500, fontSize: 26, margin: "0 0 10px" }}>Where are you going?</h2>
              <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "#6E6B64", maxWidth: 430, margin: "0 auto 22px" }}>
                Add your destination and travel dates. FLY pulls the real forecast for each stop and builds a packing list from the clothes you already own.
              </p>
              <button
                className="focus-ring"
                onClick={() => setShowItinerary(true)}
                style={{ display: "inline-flex", alignItems: "center", gap: 9, background: "#211D18", color: "#EDE7DD", border: "none", borderRadius: 999, padding: "13px 28px", fontSize: 15, fontWeight: 500, cursor: "pointer" }}
              >
                Plan a new trip <ChevronRight size={16} />
              </button>
            </div>
          </div>
        ) : (
        <>
        {showGuide && (
          <section style={{ marginBottom: 30, border: "1px solid #E4DDCE", background: "#F7F3EA", borderRadius: 16, padding: "18px 20px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#B85C38" }}>How to plan your trip</span>
              <button className="focus-ring" onClick={() => { setShowGuide(false); markOnboarded(); }} aria-label="Dismiss" style={{ background: "none", border: "none", cursor: "pointer", color: "#8A8172", display: "flex" }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              {[
                { n: 1, title: "Set your trip", body: "Add where you're going and your dates — stack as many stops as you like.", label: "Edit destination & dates", onClick: () => setShowItinerary(true) },
                { n: 2, title: "Add your closet", body: "Tell FLY what you already own so it only suggests what you're missing.", label: "Set up your closet", onClick: openCloset },
                { n: 3, title: "Pack & shop", body: "FLY matches the forecast to your closet and flags exactly what to buy.", note: "Happens automatically" },
              ].map((s) => (
                <div key={s.n} style={{ background: "#FFFFFF", border: "1px solid #E4DDCE", borderRadius: 12, padding: "14px 14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ width: 22, height: 22, borderRadius: 999, background: "#211D18", color: "#EDE7DD", fontFamily: FONT_MONO, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>{s.n}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{s.title}</span>
                  </div>
                  <p style={{ fontSize: 12.5, lineHeight: 1.5, color: "#6E6B64", margin: "0 0 12px" }}>{s.body}</p>
                  {s.onClick ? (
                    <button className="focus-ring" onClick={s.onClick} style={{ background: "#EFE7D8", border: "1px solid #D8D0C0", borderRadius: 999, padding: "7px 13px", fontSize: 12, fontWeight: 500, color: "#211D18", cursor: "pointer" }}>{s.label}</button>
                  ) : (
                    <span style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "#74856A" }}>{s.note}</span>
                  )}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, fontSize: 12.5, color: "#8A8172" }}>
              This is a sample trip so you can see how it all fits together.{" "}
              <button className="focus-ring" onClick={startFreshTrip} style={{ background: "none", border: "none", padding: 0, fontSize: 12.5, color: "#B85C38", textDecoration: "underline", cursor: "pointer", fontWeight: 500 }}>
                Start a fresh trip
              </button>
            </div>
          </section>
        )}
        {/* weather — forecast for the active stop; tabs above switch stops */}
        <section style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#74856A" }}>
              {active ? `${active.label} · ${prettyDate(active.start)}–${prettyDate(active.end)}` : "no destination yet"}
            </span>
            {current && current !== "loading" && current !== "error" && current.source === "seasonal" && (
              <span style={{ fontSize: 10, fontFamily: FONT_MONO, background: "#F2ECE0", color: "#8A8172", padding: "2px 8px", borderRadius: 999 }}>
                seasonal average
              </span>
            )}
            {active?.approximate && (
              <span style={{ fontSize: 10, fontFamily: FONT_MONO, background: "#FFF3C4", color: "#6B5A1E", padding: "2px 8px", borderRadius: 999 }}>
                approximate — add stops in {active.label} for accuracy
              </span>
            )}
          </div>

          {!active ? (
            <div style={{ fontSize: 12.5, color: "#8A8172" }}>Add a country or a stop to see weather.</div>
          ) : active.lat == null ? (
            <div style={{ fontSize: 12.5, color: "#8A8172" }}>Add a stop in {active.label} for a forecast.</div>
          ) : !current || current === "loading" ? (
            <div style={{ fontSize: 12.5, color: "#8A8172" }}>Checking the forecast…</div>
          ) : current === "error" ? (
            <div style={{ fontSize: 12.5, color: "#B85C38" }}>Couldn't load weather for {active.label}.</div>
          ) : (
            <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
              {weatherDays.map((d) => (
                <div key={d.date} style={{ background: "#F7F3EA", borderRadius: 10, padding: "14px 16px", minWidth: 88, flexShrink: 0, textAlign: "center", border: "1px solid #E4DDCE" }}>
                  <div style={{ fontSize: 11, color: "#8A8172", marginBottom: 8 }}>{prettyDate(d.date)}</div>
                  <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
                    <WeatherIcon icon={d.icon} size={20} color={d.icon === "rain" ? "#5B6B8C" : "#C79A44"} />
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 13.5, fontWeight: 500 }}>{d.hi}°</div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: "#8A8172" }}>{d.lo}°</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* packing */}
        <section style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <CloudSun size={14} color="#B85C38" />
              <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#B85C38" }}>suggested for this trip</span>
            </div>
            <button className="focus-ring" onClick={openCloset} style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "1px solid #C9BFA9", borderRadius: 999, padding: "5px 12px", fontSize: 11.5, color: "#211D18" }}>
              <Luggage size={12} /> {wardrobe.length > 0 ? `Closet (${wardrobe.length})` : "Set up your closet"}
            </button>
          </div>
          {conditions && (
            <p style={{ fontSize: 11.5, color: "#8A8172", margin: "4px 0 14px" }}>
              Based on {conditions.minLo}–{conditions.maxHi}°C{conditions.rainDays > 0 ? `, rain on ${conditions.rainDays} ${conditions.rainDays === 1 ? "day" : "days"}` : ", no rain forecast"}.
            </p>
          )}
          <div style={{ background: "#F7F3EA", borderRadius: 12, overflow: "hidden", border: "1px solid #D8D0C0", marginTop: conditions ? 0 : 14 }}>
            {suggested.map((item, idx) => {
              const rec = recommendFor(item, conditions, legs, tripDays);
              if (!rec.show) return null;
              const hasCloset = wardrobe.length > 0;
              const trackable = !!item.category && hasCloset;
              const needed = rec.qty != null ? rec.qty : 1;
              const ownedPieces = closetMatchesFor(item, wardrobe);
              const ownedQty = ownedPieces.reduce((s, w) => s + (w.qty || 0), 0);
              const gap = Math.max(0, needed - ownedQty);
              const covered = ownedQty >= needed && ownedQty > 0;
              const buyPrimary = trackable && gap > 0;
              const buyLabel = !trackable ? "Shop" : ownedQty === 0 ? "Shop" : gap > 0 ? `Shop ${gap} more` : "New";
              return (
                <div key={item.id} className="item-row" style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px", borderBottom: idx < suggested.length - 1 ? "1px solid #E4DDCE" : "none" }}>
                  <div className="checkbox focus-ring" role="checkbox" tabIndex={0} aria-checked={item.packed} aria-label={`Mark ${item.label} as ${item.packed ? "not packed" : "packed"}`} onClick={() => toggleSuggested(item.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleSuggested(item.id); }} style={{ width: 20, height: 20, borderRadius: 6, border: "1.5px solid " + (item.packed ? "#74856A" : "#C9BFA9"), background: item.packed ? "#74856A" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {item.packed && <Check size={13} color="#F7F3EA" />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, opacity: item.packed ? 0.55 : 1, textDecoration: item.packed ? "line-through" : "none" }}>
                      {item.label}
                      {rec.qty !== null && <span style={{ fontFamily: FONT_MONO, color: "#8A8172", fontWeight: 400, marginLeft: 6 }}>×{rec.qty}</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: "#8A8172", marginTop: 2 }}>{rec.reason}</div>
                    {trackable && (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 6, fontFamily: FONT_MONO, fontSize: 10, padding: "3px 8px", borderRadius: 999, background: covered ? "#E9EFE4" : "#F6E7DF", color: covered ? "#556B4A" : "#9A4A2B" }}>
                        {covered
                          ? <><Check size={9} /> in your closet{needed > 1 ? ` · ${ownedQty} of ${needed}` : ""}</>
                          : ownedQty > 0
                            ? <>you own {ownedQty} of {needed}</>
                            : <>not in your closet</>}
                      </div>
                    )}
                  </div>
                  {item.category && (
                    <button
                      className="focus-ring"
                      onClick={(e) => { e.stopPropagation(); setShopItem({ ...item, _needed: needed, _owned: ownedQty, _gap: gap }); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 5, flexShrink: 0, whiteSpace: "nowrap",
                        borderRadius: 999, padding: "7px 12px", fontSize: 11.5,
                        background: buyPrimary ? "#211D18" : "transparent",
                        color: buyPrimary ? "#EDE7DD" : "#74856A",
                        border: buyPrimary ? "none" : "1px solid #D8D0C0",
                      }}
                    >
                      <ShoppingBag size={12} />
                      {buyLabel}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* everything else — collapsed by default so it never crowds the core
            clothing list. Grouped travel essentials, tailored to the trip's
            weather, coast, length and destination (adapter type). */}
        <section>
          <button
            className="focus-ring"
            onClick={() => setShowEssentials((v) => !v)}
            aria-expanded={showEssentials}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "#F7F3EA", border: "1px solid #D8D0C0", borderRadius: 12, padding: "14px 16px", textAlign: "left" }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <Luggage size={15} color="#74856A" style={{ flexShrink: 0 }} />
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#74856A" }}>everything else</span>
                <span style={{ fontSize: 12, color: "#8A8172", marginTop: 2 }}>Essentials, tech & toiletries — tailored to your trip</span>
              </span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: "#8A8172" }}>{essentialsPacked}/{visibleOther.length}</span>
              <ChevronDown size={18} color="#74856A" style={{ transform: showEssentials ? "rotate(180deg)" : "none", transition: "transform 0.18s" }} />
            </span>
          </button>

          {showEssentials && (
            <div style={{ marginTop: 12, background: "#F7F3EA", borderRadius: 12, overflow: "hidden", border: "1px solid #D8D0C0" }}>
              {ESSENTIAL_GROUP_META.map((group) => {
                const items = essentialItems.filter((i) => i.group === group.id);
                if (items.length === 0) return null;
                return (
                  <div key={group.id}>
                    <div style={{ padding: "11px 16px 6px", background: "#F0EADF", fontFamily: FONT_MONO, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "#A08F73" }}>{group.label}</div>
                    {items.map((item) => {
                      const label = item.adapter ? adapterInfo.label : item.label;
                      const note = item.adapter ? adapterInfo.note : item.note;
                      const shopUrl = item.shop ? buyLinkFor({ title: item.adapter ? adapterInfo.search : (item.search || item.label) }).url : null;
                      return (
                        <div key={item.id} className="item-row" style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderTop: "1px solid #E4DDCE" }}>
                          <div className="checkbox focus-ring" role="checkbox" tabIndex={0} aria-checked={item.packed} aria-label={`Mark ${label} as ${item.packed ? "not packed" : "packed"}`} onClick={() => toggleOther(item.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleOther(item.id); }} style={{ width: 20, height: 20, borderRadius: 6, border: "1.5px solid " + (item.packed ? "#74856A" : "#C9BFA9"), background: item.packed ? "#74856A" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            {item.packed && <Check size={13} color="#F7F3EA" />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 500, opacity: item.packed ? 0.55 : 1, textDecoration: item.packed ? "line-through" : "none" }}>{label}</div>
                            {note && <div style={{ fontSize: 11.5, color: "#8A8172", marginTop: 2 }}>{note}</div>}
                          </div>
                          {shopUrl && (
                            <a
                              className="focus-ring"
                              href={shopUrl}
                              target="_blank"
                              rel="sponsored noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0, whiteSpace: "nowrap", textDecoration: "none", borderRadius: 999, padding: "7px 12px", fontSize: 11.5, background: "transparent", color: "#74856A", border: "1px solid #D8D0C0" }}
                            >
                              <ShoppingBag size={12} /> Shop
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              <div>
                <div style={{ padding: "11px 16px 6px", background: "#F0EADF", fontFamily: FONT_MONO, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "#A08F73" }}>Your items</div>
                {customItems.map((item) => (
                  <div key={item.id} className="item-row" style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderTop: "1px solid #E4DDCE" }}>
                    <div className="checkbox focus-ring" role="checkbox" tabIndex={0} aria-checked={item.packed} aria-label={`Mark ${item.label} as ${item.packed ? "not packed" : "packed"}`} onClick={() => toggleOther(item.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleOther(item.id); }} style={{ width: 20, height: 20, borderRadius: 6, border: "1.5px solid " + (item.packed ? "#74856A" : "#C9BFA9"), background: item.packed ? "#74856A" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {item.packed && <Check size={13} color="#F7F3EA" />}
                    </div>
                    <div style={{ flex: 1, fontSize: 13.5, fontWeight: 500, opacity: item.packed ? 0.55 : 1, textDecoration: item.packed ? "line-through" : "none" }}>{item.label}</div>
                  </div>
                ))}
                <button className="focus-ring" onClick={() => setShowAdd(true)} style={{ display: "flex", alignItems: "center", gap: 5, width: "100%", background: "none", border: "none", borderTop: "1px solid #E4DDCE", color: "#211D18", fontSize: 12.5, padding: "12px 16px", textAlign: "left" }}>
                  <Plus size={13} /> add your own item
                </button>
              </div>

              <div style={{ padding: "10px 16px", borderTop: "1px solid #E4DDCE", fontSize: 10.5, color: "#A08F73", lineHeight: 1.5 }}>
                Shop links open Amazon and may earn us a small commission — at no extra cost to you.
              </div>
            </div>
          )}
        </section>
        </>
        )}
      </div>

      {/* ---- edit trip modal ---- */}
      {showItinerary && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(33,29,24,0.42)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }} onClick={() => setShowItinerary(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#F7F3EA", borderRadius: 14, padding: 24, width: 480, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 30px 60px -20px rgba(33,29,24,0.4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 500, margin: 0 }}>Your trip</h2>
              <button className="focus-ring" onClick={() => setShowItinerary(false)} style={{ background: "none", border: "none" }}><X size={18} /></button>
            </div>
            <p style={{ fontSize: 12, color: "#8A8172", margin: "0 0 18px", lineHeight: 1.5 }}>
              Add where you're going and when. Days split evenly across countries — adjust as you like. Add stops within a country for accurate forecasts instead of approximate ones.
            </p>

            {/* dates */}
            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: "#8A8172", display: "block", marginBottom: 5 }}>Start</label>
                <input className="focus-ring" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid #D8D0C0", fontSize: 13.5, background: "#fff" }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: "#8A8172", display: "block", marginBottom: 5 }}>End</label>
                <input className="focus-ring" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid #D8D0C0", fontSize: 13.5, background: "#fff" }} />
              </div>
            </div>

            {/* countries */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: "#8A8172" }}>Countries</label>
              <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: unassigned === 0 ? "#74856A" : unassigned < 0 ? "#B85C38" : "#8A8172" }}>
                {tripDays}d total{unassigned !== 0 && ` · ${unassigned > 0 ? `${unassigned} unassigned` : `${Math.abs(unassigned)} over`}`}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
              {countries.map((c, ci) => {
                const stops = legs.filter((l) => l.country === c.name);
                const stopDays = stops.reduce((s, l) => s + (l.nights || 0), 0);
                return (
                  <div key={c.id} style={{ background: "#fff", border: "1px solid #E4DDCE", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
                        <button aria-label={`Move ${c.name} earlier`} className="focus-ring" onClick={() => moveCountry(c.id, -1)} disabled={ci === 0} style={{ background: "none", border: "none", padding: 0, lineHeight: 1, color: ci === 0 ? "#D8D0C0" : "#8A8172", fontSize: 10 }}>▲</button>
                        <button aria-label={`Move ${c.name} later`} className="focus-ring" onClick={() => moveCountry(c.id, 1)} disabled={ci === countries.length - 1} style={{ background: "none", border: "none", padding: 0, lineHeight: 1, color: ci === countries.length - 1 ? "#D8D0C0" : "#8A8172", fontSize: 10 }}>▼</button>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>{c.name}</div>
                        <div style={{ fontSize: 10.5, color: "#8A8172" }}>
                          {stops.length > 0 ? `${stops.length} ${stops.length === 1 ? "stop" : "stops"} · ${stopDays}d` : "approximate weather"}
                        </div>
                      </div>
                      {stops.length === 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                          <button aria-label={`Fewer days in ${c.name}`} className="focus-ring" onClick={() => setCountryNights(c.id, (c.nights || 0) - 1)} style={{ width: 22, height: 22, borderRadius: "50%", border: "1px solid #C9BFA9", background: "transparent", color: "#74856A", fontSize: 13, lineHeight: 1, padding: 0 }}>−</button>
                          <span style={{ fontFamily: FONT_MONO, fontSize: 12.5, minWidth: 34, textAlign: "center" }}>{c.nights || 0}d</span>
                          <button aria-label={`More days in ${c.name}`} className="focus-ring" onClick={() => setCountryNights(c.id, (c.nights || 0) + 1)} style={{ width: 22, height: 22, borderRadius: "50%", border: "1px solid #C9BFA9", background: "transparent", color: "#74856A", fontSize: 13, lineHeight: 1, padding: 0 }}>+</button>
                        </div>
                      )}
                      <button aria-label={`Remove ${c.name}`} className="focus-ring" onClick={() => removeCountry(c.id)} style={{ background: "none", border: "none", color: "#B85C38", flexShrink: 0, padding: 4 }}><X size={14} /></button>
                    </div>

                    {/* stops nested under their country */}
                    {stops.length > 0 && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #E4DDCE", display: "flex", flexDirection: "column", gap: 7 }}>
                        {stops.map((l, li) => (
                          <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 4 }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 1, flexShrink: 0 }}>
                              <button aria-label={`Move ${l.city} earlier`} className="focus-ring" onClick={() => moveLeg(l.id, -1)} disabled={li === 0} style={{ background: "none", border: "none", padding: 0, lineHeight: 1, color: li === 0 ? "#E4DDCE" : "#8A8172", fontSize: 8 }}>▲</button>
                              <button aria-label={`Move ${l.city} later`} className="focus-ring" onClick={() => moveLeg(l.id, 1)} disabled={li === stops.length - 1} style={{ background: "none", border: "none", padding: 0, lineHeight: 1, color: li === stops.length - 1 ? "#E4DDCE" : "#8A8172", fontSize: 8 }}>▼</button>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12.5 }}>{l.city}</div>
                              {l.coastal && (
                                <span title="Detected automatically from location" style={{ marginTop: 3, display: "inline-flex", alignItems: "center", gap: 4, background: "#EAF0E4", color: "#5C6B50", border: "1px solid #CBD8BE", borderRadius: 999, padding: "1px 8px", fontSize: 9.5, fontFamily: FONT_MONO }}>
                                  coastal
                                </span>
                              )}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                              <button aria-label={`Fewer days in ${l.city}`} className="focus-ring" onClick={() => updateLegNights(l.id, l.nights - 1)} style={{ width: 19, height: 19, borderRadius: "50%", border: "1px solid #C9BFA9", background: "transparent", color: "#74856A", fontSize: 11, lineHeight: 1, padding: 0 }}>−</button>
                              <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, minWidth: 26, textAlign: "center" }}>{l.nights}d</span>
                              <button aria-label={`More days in ${l.city}`} className="focus-ring" onClick={() => updateLegNights(l.id, l.nights + 1)} style={{ width: 19, height: 19, borderRadius: "50%", border: "1px solid #C9BFA9", background: "transparent", color: "#74856A", fontSize: 11, lineHeight: 1, padding: 0 }}>+</button>
                            </div>
                            <button aria-label={`Remove ${l.city}`} className="focus-ring" onClick={() => removeLeg(l.id)} style={{ background: "none", border: "none", color: "#B85C38", flexShrink: 0, padding: 3 }}><X size={12} /></button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* per-country stop field — belongs to THIS country, so
                        there's no ambiguity about what you're adding to */}
                    <div style={{ marginTop: stops.length > 0 ? 10 : 10, paddingTop: 10, borderTop: stops.length > 0 ? "none" : "1px dashed #E4DDCE" }}>
                      {openStopFor === c.id ? (
                        <div>
                          <PlaceAutocomplete
                            value={stopQuery}
                            onChange={setStopQuery}
                            onSelect={(p) => addStopToCountry(c.id, p)}
                            bias={c.countryCode ? [c.countryCode] : countryBias}
                            autoFocus
                            placeholder={`Search a city in ${c.name}`}
                          />
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 7 }}>
                            <span style={{ fontSize: 10.5, color: "#8A8172" }}>
                              {stops.length > 0 ? "Add another, or close when done." : "Skip to use approximate weather for the whole country."}
                            </span>
                            <button className="focus-ring" onClick={() => { setOpenStopFor(null); setStopQuery(""); }} style={{ background: "none", border: "1px solid #D8D0C0", borderRadius: 999, padding: "3px 11px", fontSize: 11, color: "#8A8172" }}>
                              {stops.length > 0 ? "Done" : "Skip"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className="focus-ring"
                          onClick={() => { setOpenStopFor(c.id); setStopQuery(""); }}
                          style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px dashed #C9BFA9", borderRadius: 8, padding: "7px 12px", fontSize: 12, color: "#211D18", width: "100%" }}
                        >
                          <Plus size={13} />
                          {stops.length > 0 ? `Add another stop in ${c.name}` : `Add a stop in ${c.name}`}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {countries.length === 0 && !showCountryField && (
                <button
                  className="focus-ring"
                  onClick={() => { setShowCountryField(true); setCountryQuery(""); }}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "none", border: "1.5px dashed #C9BFA9", borderRadius: 10, padding: "22px 16px", fontSize: 13.5, color: "#211D18", width: "100%" }}
                >
                  <Plus size={16} />
                  Start planning
                </button>
              )}
            </div>

            {/* add country */}
            {(countries.length > 0 || showCountryField) && (
              <div style={{ marginBottom: 20 }}>
                {showCountryField ? (
                  <div>
                    <PlaceAutocomplete
                      value={countryQuery}
                      onChange={setCountryQuery}
                      onSelect={(p) => { addCountry(p); setShowCountryField(false); }}
                      type="country"
                      autoFocus
                      placeholder="Which country?"
                    />
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 7 }}>
                      <button className="focus-ring" onClick={() => { setShowCountryField(false); setCountryQuery(""); }} style={{ background: "none", border: "1px solid #D8D0C0", borderRadius: 999, padding: "3px 11px", fontSize: 11, color: "#8A8172" }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="focus-ring"
                    onClick={() => { setShowCountryField(true); setCountryQuery(""); }}
                    style={{ display: "flex", alignItems: "center", gap: 7, background: "none", border: "1px dashed #C9BFA9", borderRadius: 8, padding: "9px 13px", fontSize: 12.5, color: "#211D18", width: "100%" }}
                  >
                    <Plus size={14} />
                    Add another country
                  </button>
                )}
              </div>
            )}

            <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px dashed #D8D0C0", fontSize: 11.5, color: "#8A8172" }}>
              {prettyDate(startDate)} – {prettyDate(endDate)} · {tripDays} {tripDays === 1 ? "day" : "days"}
              {countries.length > 1 && ` · ${countries.length} countries`}
            </div>
          </div>
        </div>
      )}

      {showCloset && (
        <ClosetSetup wardrobe={wardrobe} onSave={setWardrobe} onClose={() => setShowCloset(false)} />
      )}

      {showClosetView && (
        <ClosetView
          wardrobe={wardrobe}
          onSave={setWardrobe}
          onClose={() => setShowClosetView(false)}
          onAddMore={() => { setShowClosetView(false); setShowCloset(true); }}
        />
      )}

      {showAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(33,29,24,0.42)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }} onClick={() => setShowAdd(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#F7F3EA", borderRadius: 14, padding: 24, width: 340, maxWidth: "100%", boxShadow: "0 30px 60px -20px rgba(33,29,24,0.4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 500, margin: 0 }}>Add to luggage</h2>
              <button className="focus-ring" onClick={() => setShowAdd(false)} style={{ background: "none", border: "none" }}><X size={18} /></button>
            </div>
            <input autoFocus className="focus-ring" value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addOther()} placeholder="e.g. Travel adapter" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #D8D0C0", marginBottom: 16, fontSize: 13.5, background: "#fff" }} />
            <button className="focus-ring" onClick={addOther} style={{ width: "100%", background: "#211D18", color: "#EDE7DD", border: "none", borderRadius: 999, padding: "12px 0", fontSize: 14, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              Add item <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {shopItem && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(33,29,24,0.42)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }} onClick={() => setShopItem(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#F7F3EA", borderRadius: 14, padding: 24, width: 420, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 30px 60px -20px rgba(33,29,24,0.4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
              <div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8A8172", marginBottom: 4 }}>shop for</div>
                <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 21, fontWeight: 500, margin: 0 }}>{shopItem.label}</h2>
              </div>
              <button className="focus-ring" onClick={() => setShopItem(null)} style={{ background: "none", border: "none" }}><X size={18} /></button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, margin: "16px 0 4px" }}>
              <Sparkles size={13} color="#B85C38" />
              <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "#B85C38" }}>
                {pins.length === 0 ? "popular picks for you" : "matched to your style"}
              </span>
            </div>
            <p style={{ fontSize: 11.5, color: "#8A8172", margin: "4px 0 16px", lineHeight: 1.5 }}>
              {shopItem && shopItem._gap > 0
                ? `This trip calls for about ${shopItem._needed} and you own ${shopItem._owned}. Here ${shopItem._gap === 1 ? "is" : "are"} ${shopItem._gap} more${pins.length === 0 ? ", starting with what's trending." : ", ranked to your style."}`
                : pins.length === 0
                ? "Trending and best-value picks to start. Like a few pieces in Discover and these get ranked to your taste."
                : "Ranked using the colours and price range you've liked."}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {shopMatches.map(({ item, factors }, i) => <MatchCard key={item.id} item={item} factors={factors} index={i} />)}
              {shopMatches.length === 0 && (
                <div style={{ fontSize: 12.5, color: "#8A8172" }}>Nothing matching this yet.</div>
              )}
            </div>
            <p style={{ fontSize: 10.5, color: "#A39B8A", margin: "16px 0 0", lineHeight: 1.5 }}>{AFFILIATE_DISCLOSURE}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------
   SCREEN: SHELF (profile + explore)
--------------------------------------------------- */

function initials(name) {
  return name.split(" ").map((p) => p[0]).join("").toUpperCase();
}

// Mock social graph. Real version needs a backend — these stand in so the
// profile and explore views can be designed and reviewed now.
const ME = {
  id: "me",
  name: "You",
  handle: "@you",
  bio: "Building a wardrobe that actually feels like me.",
  avatar: "#C4A5A0",
  followers: 34,
  following: 51,
};

const PEOPLE = [
  { id: "u1", name: "Marta O.", handle: "@marta", bio: "Slow travel, linen, good coffee.", avatar: "#8C6A5B", followers: 1240, following: 189, trips: ["t1", "t8"], followed: true },
  { id: "u2", name: "Jonas B.", handle: "@jonasb", bio: "Kyoto in spring is the whole personality.", avatar: "#C79A44", followers: 892, following: 210, trips: ["t2"], followed: false },
  { id: "u3", name: "Priya S.", handle: "@priya", bio: "One carry-on, always.", avatar: "#5B6B8C", followers: 415, following: 98, trips: ["t3"], followed: true },
  { id: "u4", name: "Tomás R.", handle: "@tomasr", bio: "Mountains, mostly.", avatar: "#3E4A3D", followers: 2103, following: 76, trips: ["t4"], followed: false },
];

// Finds who packed a given trip. Lives at module scope because both the shelf
// and the trip detail screen need it, and they're siblings under the shell.
function authorOfTrip(trip, people) {
  if (!trip) return null;
  return people.find((u) => u.trips?.includes(trip.id)) || null;
}


function Avatar({ color, name, size = 40 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        color: "#F7F3EA",
        fontSize: size * 0.36,
        fontFamily: FONT_MONO,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {initials(name)}
    </div>
  );
}

function LuggageCard({ trip, onOpen, onOpenAuthor, author, compact = false, onRemove }) {
  return (
    <div
      className="trip-card"
      onClick={() => onOpen(trip)}
      style={{
        background: "#F7F3EA",
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 8px 18px -12px rgba(33,29,24,0.25)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ height: compact ? 110 : 140, background: `linear-gradient(155deg, ${trip.cover[0]}, ${trip.cover[1]})`, position: "relative" }}>
        {trip.tagged && (
          <div style={{ position: "absolute", bottom: 8, left: 8, display: "flex", alignItems: "center", gap: 4, background: "rgba(247,243,234,0.92)", borderRadius: 999, padding: "3px 8px", fontSize: 9.5, fontFamily: FONT_MONO }}>
            <ShoppingBag size={9} /> shop this
          </div>
        )}
      </div>
      <div style={{ padding: "11px 12px 13px" }}>
        <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 500, margin: "0 0 3px" }}>{trip.title}</h3>
        <div style={{ fontSize: 11, color: "#8A8172", display: "flex", alignItems: "center", gap: 4, marginBottom: 8 }}>
          <MapPin size={9} />
          {trip.cities.join(" · ")}
        </div>
        <RouteStrip cities={trip.cities} w={compact ? 80 : 100} />

        {/* author — the route from a place-based search to the person */}
        {author && onOpenAuthor && (
          <button
            className="focus-ring"
            onClick={(e) => {
              e.stopPropagation(); // don't open the trip
              onOpenAuthor(author.id);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              background: "none",
              border: "none",
              padding: "9px 0 0",
              marginTop: 2,
              width: "100%",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <Avatar color={author.avatar} name={author.name} size={22} />
            <span style={{ fontSize: 11.5, color: "#211D18", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {author.name}
            </span>
          </button>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 9, paddingTop: 9, borderTop: "1px dashed #D8D0C0" }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: "#8A8172" }}>{trip.duration}</span>
          {onRemove ? (
            <button
              className="focus-ring"
              onClick={(e) => { e.stopPropagation(); onRemove(trip.id); }}
              style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "#8A8172", fontSize: 11, cursor: "pointer", padding: 0 }}
            >
              <X size={11} /> Remove
            </button>
          ) : (
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#8A8172" }}>
              <Heart size={10} /> {trip.likes}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// One step in the first-run setup card. Shows a numbered/checked marker, a
// short explanation, and a single action — kept deliberately minimal so a new
// user always knows the next thing to do.
function SetupStep({ done, icon: Icon, title, desc, cta, onClick }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 13, background: "#fff", border: "1px solid #E4DDCE", borderRadius: 11, padding: "12px 14px" }}>
      <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: done ? "#74856A" : "#EDE7DD", color: done ? "#F7F3EA" : "#74856A" }}>
        {done ? <Check size={17} /> : <Icon size={16} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: 11.5, color: "#8A8172", lineHeight: 1.45 }}>{desc}</div>
      </div>
      <button className="focus-ring" onClick={onClick} style={{ flexShrink: 0, background: done ? "transparent" : "#211D18", color: done ? "#211D18" : "#EDE7DD", border: done ? "1px solid #D8D0C0" : "none", borderRadius: 999, padding: "8px 16px", fontSize: 12.5, fontWeight: 500 }}>
        {cta}
      </button>
    </div>
  );
}

// Reusable empty-state panel for the You tab's sections.
function EmptyState({ icon: Icon, title, body, cta, onClick }) {
  return (
    <div style={{ border: "1.5px dashed #C9BFA9", borderRadius: 14, padding: "44px 24px", textAlign: "center" }}>
      {Icon && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
          <div style={{ width: 46, height: 46, borderRadius: "50%", background: "#F7F3EA", display: "flex", alignItems: "center", justifyContent: "center", color: "#74856A" }}>
            <Icon size={20} />
          </div>
        </div>
      )}
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 500, marginBottom: 5 }}>{title}</div>
      <p style={{ fontSize: 13, color: "#8A8172", margin: "0 auto 18px", lineHeight: 1.5, maxWidth: 340 }}>{body}</p>
      {cta && (
        <button className="focus-ring" onClick={onClick} style={{ background: "#211D18", color: "#EDE7DD", border: "none", borderRadius: 999, padding: "10px 22px", fontSize: 13, fontWeight: 500 }}>
          {cta}
        </button>
      )}
    </div>
  );
}

// The "You" tab — the user's own space: their profile, saved trips, closet, and
// liked pieces. Social discovery (following other travellers, exploring their
// luggages) is intentionally left out of v1 so the experience is focused and
// makes sense before there's a user base; the plumbing can be reintroduced
// later. A brand-new account is guided by a two-step setup that leads straight
// to the two things that make everything else work: the closet and a first trip.
function ShelfScreen({ liked, savedTrips = [], onOpenSavedTrip, onRemoveSavedTrip, wardrobe = [], setWardrobe, closetPublic = false, setClosetPublic, onGoTo }) {
  const [section, setSection] = useState("trips"); // trips | closet | liked
  const [showCloset, setShowCloset] = useState(false); // swipe-deck setup
  const [showClosetView, setShowClosetView] = useState(false); // saved-closet editor
  const openCloset = useCallback(() => {
    if (wardrobe.length > 0) setShowClosetView(true);
    else setShowCloset(true);
  }, [wardrobe.length]);

  // Trips the user has saved from the Trip planner. A fresh account has none,
  // so the section shows its empty state (never borrowed sample data).
  const myTrips = savedTrips;

  const closetPieces = wardrobe.reduce((n, w) => n + (w.qty || 1), 0);
  const closetDone = wardrobe.length > 0;
  const tripsDone = myTrips.length > 0;
  const showSetup = !closetDone || !tripsDone;

  const sections = [
    { id: "trips", label: `Trips (${myTrips.length})` },
    { id: "closet", label: `Closet (${wardrobe.length})` },
    { id: "liked", label: `Liked (${liked.length})` },
  ];

  const goTrip = () => onGoTo && onGoTo("trip");
  const goDiscover = () => onGoTo && onGoTo("board");

  return (
    <div>
      <header style={{ padding: "24px 32px 0", borderBottom: "1px solid #D8D0C0" }}>
        {/* profile */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
          <Avatar color={ME.avatar} name={ME.name} size={62} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 500, fontSize: 28, margin: "0 0 2px" }}>{ME.name}</h1>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: "#8A8172", marginBottom: 8 }}>{ME.handle}</div>
            <p style={{ fontSize: 13, margin: "0 0 10px", lineHeight: 1.5 }}>{ME.bio}</p>
            <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#8A8172" }}>
              <span><strong style={{ color: "#211D18" }}>{myTrips.length}</strong> {myTrips.length === 1 ? "trip" : "trips"}</span>
              <span><strong style={{ color: "#211D18" }}>{closetPieces}</strong> closet {closetPieces === 1 ? "piece" : "pieces"}</span>
              <span><strong style={{ color: "#211D18" }}>{liked.length}</strong> liked</span>
            </div>
          </div>
        </div>

        {/* section tabs */}
        <div style={{ display: "flex", gap: 20 }}>
          {sections.map((s) => (
            <button
              key={s.id}
              className="focus-ring"
              onClick={() => setSection(s.id)}
              style={{
                background: "none",
                border: "none",
                borderBottom: "2px solid " + (section === s.id ? "#211D18" : "transparent"),
                padding: "0 0 12px",
                fontSize: 13,
                fontWeight: section === s.id ? 500 : 400,
                color: section === s.id ? "#211D18" : "#8A8172",
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      <div style={{ padding: "24px 32px 60px" }}>
        {/* First-run setup — the two core actions, front and centre. Disappears
            once the closet is built and a trip is saved. */}
        {showSetup && (
          <div style={{ background: "#F7F3EA", border: "1px solid #E4DDCE", borderRadius: 14, padding: "18px 20px", marginBottom: 26 }}>
            <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "#74856A", marginBottom: 3 }}>get started</div>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 500, margin: "0 0 3px" }}>Set up your FLY</h2>
            <p style={{ fontSize: 12.5, color: "#8A8172", margin: "0 0 16px", lineHeight: 1.5 }}>
              Tell FLY what you own and where you're headed — then every trip shows exactly what to pack and what's still worth buying.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SetupStep
                done={closetDone}
                icon={ShoppingBag}
                title="Build your closet"
                desc={closetDone ? `${closetPieces} ${closetPieces === 1 ? "piece" : "pieces"} in your closet` : "Add what you already own so trips only suggest what's missing."}
                cta={closetDone ? "Edit closet" : "Set up closet"}
                onClick={openCloset}
              />
              <SetupStep
                done={tripsDone}
                icon={Plane}
                title="Plan your first trip"
                desc={tripsDone ? "Your trip is saved." : "Add where you're going and your dates to get a packing plan."}
                cta="Plan a trip"
                onClick={goTrip}
              />
            </div>
          </div>
        )}

        {section === "trips" ? (
          myTrips.length === 0 ? (
            <EmptyState
              icon={Luggage}
              title="No saved trips yet"
              body="Plan a trip and it'll be saved here — ready to reopen and re-pack any time."
              cta="Plan a trip"
              onClick={goTrip}
            />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
              {myTrips.map((t) => <LuggageCard key={t.id} trip={t} onOpen={onOpenSavedTrip} onRemove={onRemoveSavedTrip} />)}
            </div>
          )
        ) : section === "closet" ? (
          <ClosetSection
            wardrobe={wardrobe}
            closetPublic={closetPublic}
            setClosetPublic={setClosetPublic}
            onEdit={openCloset}
          />
        ) : (
          liked.length === 0 ? (
            <EmptyState
              icon={Heart}
              title="Nothing liked yet"
              body="Swipe through Discover to like pieces you love — they collect here and shape what every trip recommends."
              cta="Open Discover"
              onClick={goDiscover}
            />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 14 }}>
              {liked.map((item) => (
                <div key={item.id}>
                  <ProductVisual imageUrl={item.imageUrl} color={item.color} kind={item.kind} height={180} radius={10} />
                  <div style={{ fontSize: 12.5, fontWeight: 500, marginTop: 7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</div>
                  <div style={{ fontSize: 11, color: "#8A8172", display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                    <span>{item.store}</span>
                    <span style={{ fontFamily: FONT_MONO }}>${item.price}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {showCloset && setWardrobe && (
        <ClosetSetup wardrobe={wardrobe} onSave={setWardrobe} onClose={() => setShowCloset(false)} />
      )}
      {showClosetView && setWardrobe && (
        <ClosetView
          wardrobe={wardrobe}
          onSave={setWardrobe}
          onClose={() => setShowClosetView(false)}
          onAddMore={() => { setShowClosetView(false); setShowCloset(true); }}
        />
      )}
    </div>
  );
}

// The closet as it appears on the profile: a privacy toggle (keep it to
// yourself or show it on your public profile) and the owned pieces grouped by
// category, with one button back into the same setup/edit flow used in trip
// planning. Read-only here — all editing happens through the shared modals.
function ClosetSection({ wardrobe, closetPublic, setClosetPublic, onEdit }) {
  const totalPieces = wardrobe.reduce((s, w) => s + (w.qty || 0), 0);
  const grouped = CLOSET_CATEGORY_ORDER
    .map((cat) => ({ cat, items: wardrobe.filter((w) => w.category === cat) }))
    .filter((g) => g.items.length > 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        <div style={{ fontSize: 12.5, color: "#8A8172" }}>
          {wardrobe.length === 0
            ? "Set up your closet once and reuse it on every trip."
            : `${wardrobe.length} ${wardrobe.length === 1 ? "type" : "types"} · ${totalPieces} ${totalPieces === 1 ? "piece" : "pieces"}. Reused on every trip you plan.`}
        </div>
        <button
          className="focus-ring"
          onClick={onEdit}
          style={{ background: "#211D18", color: "#EDE7DD", border: "none", borderRadius: 999, padding: "9px 18px", fontSize: 12.5, fontWeight: 500 }}
        >
          {wardrobe.length > 0 ? "View & edit closet" : "Set up your closet"}
        </button>
      </div>

      {wardrobe.length > 0 && setClosetPublic && (
        <div style={{ display: "flex", gap: 8, marginBottom: 22 }}>
          {[
            { pub: false, Icon: Lock, label: "Just for me", hint: "Only you can see this" },
            { pub: true, Icon: Globe, label: "Public", hint: "Shown on your profile" },
          ].map(({ pub, Icon, label, hint }) => {
            const active = closetPublic === pub;
            return (
              <button
                key={label}
                className="focus-ring"
                onClick={() => setClosetPublic(pub)}
                title={hint}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: "1px solid " + (active ? "#211D18" : "#D8D0C0"),
                  background: active ? "#211D18" : "transparent",
                  color: active ? "#EDE7DD" : "#8A8172",
                  fontSize: 12.5,
                  fontWeight: active ? 500 : 400,
                }}
              >
                <Icon size={13} /> {label}
              </button>
            );
          })}
        </div>
      )}

      {wardrobe.length === 0 ? (
        <div style={{ border: "1.5px dashed #C9BFA9", borderRadius: 14, padding: "44px 24px", textAlign: "center", color: "#8A8172", fontSize: 13.5 }}>
          Nothing in your closet yet. Set it up so every trip can tell you what you still need to buy.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {grouped.map((g) => (
            <div key={g.cat}>
              <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "#74856A", marginBottom: 10 }}>
                {g.cat}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {g.items.map((w) => {
                  // A linked piece renders as a real product card with a photo
                  // and a buy button; an unlinked piece stays a simple chip.
                  if (w.product) {
                    const { url, tracked } = buyLinkFor(w.product);
                    return (
                      <div key={w.id} style={{ width: 132, background: "#F7F3EA", border: "1px solid #E4DDCE", borderRadius: 12, overflow: "hidden" }}>
                        <ProductVisual imageUrl={w.product.imageUrl} color={w.product.color} kind={w.product.kind || w.kind} height={132} radius={0} />
                        <div style={{ padding: "8px 9px 9px" }}>
                          <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.product.title || w.label}</div>
                          <div style={{ fontSize: 10.5, color: "#8A8172", display: "flex", justifyContent: "space-between", marginTop: 1 }}>
                            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.product.store}</span>
                            {w.product.price != null && <span style={{ fontFamily: FONT_MONO }}>${w.product.price}</span>}
                          </div>
                          <a
                            href={url}
                            target="_blank"
                            rel={tracked ? "noopener noreferrer sponsored" : "noopener noreferrer"}
                            style={{ display: "block", textAlign: "center", marginTop: 7, background: "#211D18", color: "#EDE7DD", borderRadius: 999, padding: "6px 0", fontSize: 11.5, fontWeight: 500, textDecoration: "none" }}
                          >
                            {tracked ? "Shop" : "Find it"}
                          </a>
                          {w.qty > 1 && <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: "#8A8172", textAlign: "center", marginTop: 5 }}>×{w.qty} owned</div>}
                        </div>
                      </div>
                    );
                  }
                  // Unlinked pieces still render as a photo card (using the
                  // per-kind stock image, falling back to icon/swatch), so the
                  // closet reads as one coherent visual grid rather than a mix
                  // of cards and text chips.
                  return (
                    <div key={w.id} style={{ width: 132, background: "#F7F3EA", border: "1px solid #E4DDCE", borderRadius: 12, overflow: "hidden", alignSelf: "flex-start" }}>
                      <ProductVisual color={pieceColor(w)} kind={w.kind} height={132} radius={0} />
                      <div style={{ padding: "8px 9px 9px" }}>
                        <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.label}</div>
                        <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: "#8A8172", marginTop: 1 }}>×{w.qty} owned</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function findSimilar(untaggedItem, pins) {
  const candidates = CATALOG.filter((c) => c.category === untaggedItem.category);
  if (pins.length === 0) {
    return candidates.slice(0, 3).map((item) => ({ item, factors: [{ detail: "close to the color in the photo", weight: 1 }] }));
  }
  const viewerAvg = avgColor(pins.map((p) => p.color));
  return candidates
    .map((item) => {
      const factors = [];
      let total = 0;
      const dItem = colorDistance(item.color, untaggedItem.color);
      const itemColorScore = Math.max(0, 2.2 - dItem / 100);
      if (itemColorScore > 0.3) { factors.push({ detail: "close to the color in the photo", weight: itemColorScore }); total += itemColorScore; }
      const dViewer = colorDistance(item.color, viewerAvg);
      const viewerColorScore = Math.max(0, 1.6 - dViewer / 120);
      if (viewerColorScore > 0.3) { factors.push({ detail: "fits your mood board palette", weight: viewerColorScore }); total += viewerColorScore; }
      if (item.store && item.store !== "Amazon") {
        const storeCount = pins.filter((p) => p.store === item.store).length;
        if (storeCount > 0) { factors.push({ detail: `you already like ${item.store}`, weight: 0.7 }); total += 0.7; }
      }
      const onSale = item.was > item.price;
      if (onSale) { factors.push({ detail: `${Math.round((1 - item.price / item.was) * 100)}% off`, weight: 0.4 }); total += 0.4; }
      return { item, total, factors: factors.sort((a, b) => b.weight - a.weight) };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);
}

function TripDetailScreen({ trip, pins, onBack, author, onOpenAuthor }) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(trip.likes);
  const [similarItem, setSimilarItem] = useState(null);

  const similarMatches = useMemo(() => (similarItem ? findSimilar(similarItem, pins) : []), [similarItem, pins]);

  const toggleLike = () => { setLiked((l) => !l); setLikeCount((c) => (liked ? c - 1 : c + 1)); };

  return (
    <div>
      <header style={{ padding: "22px 32px 20px", borderBottom: "1px solid #D8D0C0" }}>
        <button className="focus-ring" onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#8A8172", fontSize: 12.5, padding: 0, marginBottom: 18 }}>
          <ArrowLeft size={14} /> back to the shelf
        </button>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              {author && onOpenAuthor ? (
                <button
                  className="focus-ring"
                  onClick={() => onOpenAuthor(author.id)}
                  style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", padding: 0, cursor: "pointer" }}
                >
                  <Avatar color={author.avatar} name={author.name} size={26} />
                  <span style={{ fontSize: 13, color: "#211D18", textDecoration: "underline", textDecorationColor: "#D8D0C0", textUnderlineOffset: 3 }}>
                    {trip.author}
                  </span>
                </button>
              ) : (
                <>
                  <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#211D18", color: "#EDE7DD", fontSize: 10.5, fontFamily: FONT_MONO, display: "flex", alignItems: "center", justifyContent: "center" }}>{initials(trip.author)}</div>
                  <span style={{ fontSize: 13, color: "#8A8172" }}>{trip.author}</span>
                </>
              )}
            </div>
            <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 500, fontSize: 32, margin: "0 0 8px", letterSpacing: "-0.01em" }}>{trip.title}</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#8A8172", marginBottom: 10 }}>
              <MapPin size={12} />
              {trip.cities.join(" · ")}
            </div>
            <RouteStrip cities={trip.cities} w={180} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
            <button className="like-btn focus-ring" onClick={toggleLike} style={{ display: "flex", alignItems: "center", gap: 6, background: "#F7F3EA", border: "1px solid #D8D0C0", borderRadius: 999, padding: "8px 14px", fontSize: 13 }}>
              <Heart size={14} color="#B85C38" fill={liked ? "#B85C38" : "none"} />
              {likeCount}
            </button>
            <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: "#8A8172" }}>{trip.duration} · {trip.dates}</span>
          </div>
        </div>
      </header>

      <div style={{ padding: "28px 32px 60px", maxWidth: 860 }}>
        <section style={{ marginBottom: 36 }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#74856A", marginBottom: 14 }}>the trip</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
            {trip.palette.slice(0, 5).map((c, i) => (
              <div key={i}>
                <div style={{ height: 190, borderRadius: 10, background: `linear-gradient(155deg, ${c}, ${trip.palette[(i + 1) % trip.palette.length]})`, marginBottom: 6 }} />
                <div style={{ fontSize: 11.5, color: "#8A8172" }}>Moment {i + 1}</div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#74856A", marginBottom: 4 }}>the luggage</div>
          <p style={{ fontSize: 12, color: "#8A8172", margin: "4px 0 16px", lineHeight: 1.5 }}>
            Tagged items link to where {trip.author.split(" ")[0]} got them. Untagged items appear in the photos but weren't linked — tap "find similar" to see close matches picked for your style.
          </p>
          <div style={{ background: "#F7F3EA", borderRadius: 12, overflow: "hidden", border: "1px solid #D8D0C0" }}>
            {TRIP_LUGGAGE.map((item, idx) => (
              <div key={item.id} className="item-row" style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px", borderBottom: idx < TRIP_LUGGAGE.length - 1 ? "1px solid #E4DDCE" : "none" }}>
                <div style={{ width: 38, height: 38, borderRadius: 6, flexShrink: 0, background: `linear-gradient(160deg, ${item.color}, ${item.color}CC)` }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{item.label}</div>
                  <div style={{ fontSize: 11.5, color: "#8A8172", marginTop: 2 }}>{item.tagged ? item.store : "not tagged"}</div>
                </div>
                {item.tagged ? (
                  <>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 13, flexShrink: 0 }}>${item.price}</span>
                    <button className="focus-ring" style={{ display: "flex", alignItems: "center", gap: 5, background: "#211D18", color: "#EDE7DD", border: "none", borderRadius: 999, padding: "7px 12px", fontSize: 11.5, flexShrink: 0 }}>
                      <Tag size={11} /> view <ExternalLink size={10} />
                    </button>
                  </>
                ) : (
                  <button className="focus-ring" onClick={() => setSimilarItem(item)} style={{ display: "flex", alignItems: "center", gap: 5, background: "none", color: "#B85C38", border: "1px solid #D8D0C0", borderRadius: 999, padding: "7px 12px", fontSize: 11.5, flexShrink: 0 }}>
                    <HelpCircle size={11} /> find similar
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      {similarItem && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(33,29,24,0.42)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }} onClick={() => setSimilarItem(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#F7F3EA", borderRadius: 14, padding: 24, width: 400, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 30px 60px -20px rgba(33,29,24,0.4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
              <div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8A8172", marginBottom: 4 }}>not tagged in this luggage</div>
                <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 500, margin: 0 }}>{similarItem.label}</h2>
              </div>
              <button className="focus-ring" onClick={() => setSimilarItem(null)} style={{ background: "none", border: "none" }}><X size={18} /></button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, margin: "16px 0 4px" }}>
              <Sparkles size={13} color="#B85C38" />
              <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "#B85C38" }}>close matches for you</span>
            </div>
            <p style={{ fontSize: 11.5, color: "#8A8172", margin: "4px 0 16px", lineHeight: 1.5 }}>
              {trip.author.split(" ")[0]} didn't link a source for this piece, so these are ranked by color closeness to what's shown{pins.length > 0 ? " and fit with your own mood board" : ""}.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {similarMatches.map(({ item, factors }, i) => <MatchCard key={item.id} item={item} factors={factors} index={i} />)}
              {similarMatches.length === 0 && <div style={{ fontSize: 12.5, color: "#8A8172" }}>No close matches found for this category yet.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------
   APP SHELL: shared state + tab navigation
--------------------------------------------------- */

// Brand lockup: luggage outline holding "FLY", with the full name alongside.
// The stacked FEEL/LIKE/YOU version only reads above ~80px, so the mark here
// carries FLY and the full name sits beside it.
function Logo() {
  return (
    <svg width="212" height="44" viewBox="0 0 230 48" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Feel Like You">
      <path d="M16 13 L16 9.5 Q16 8 17.5 8 L24.5 8 Q26 8 26 9.5 L26 13" fill="none" stroke="#211D18" strokeWidth="2" strokeLinecap="round" />
      <rect x="7" y="13" width="28" height="26" rx="4" fill="none" stroke="#211D18" strokeWidth="2" />
      <text x="21" y="30" textAnchor="middle" fontFamily="Georgia, serif" fontSize="11" fontWeight="600" fill="#211D18">FLY</text>
      <text x="46" y="24" fontFamily={FONT_DISPLAY} fontSize="18" fill="#211D18">Feel Like You</text>
      <text x="47" y="36" fontFamily={FONT_BODY} fontSize="7.5" letterSpacing="1.4" fill="#8A8172">STYLE THAT'S ACTUALLY YOURS</text>
    </svg>
  );
}

/* ---------------------------------------------------
   PRIVACY POLICY
   Plain content, not styling, so it's easy for Chris to edit the actual
   wording later without touching layout code.
--------------------------------------------------- */
const AFFILIATE_DISCLOSURE = "Feel Like You (FLY) is a style discovery utility. When you purchase clothing items through our partner boutique links, we may earn a small affiliate commission at no extra cost to you. This helps support our platform.";

const PRIVACY_LAST_UPDATED = "July 2026";
const PRIVACY_CONTACT_EMAIL = "hello@shopfeellikeyou.com"; // placeholder — swap for your real inbox

const PRIVACY_SECTIONS = [
  {
    heading: "What we collect",
    body: "If you sign in, we collect the email address you give us. As you use FLY we also store the choices you make in the app itself: items you like or skip, your closet and how many of each thing you own, trips you plan, and products you watch. None of this requires a photo of you or your things.",
  },
  {
    heading: "How we use it",
    body: "Your likes and closet build the taste and packing signal that powers recommendations, so the app can tell you what a trip needs and what you're missing. Your email lets us keep your account across visits. We don't sell any of this.",
  },
  {
    heading: "Affiliate links",
    body: "Product links in FLY are affiliate links. If you buy something after clicking one, we may earn a small commission from the retailer. It costs you nothing extra, and it's how FLY stays free to use.",
  },
  {
    heading: "Third parties",
    body: "We share the minimum needed to run the app: affiliate networks to track qualifying purchases, and standard hosting and analytics providers to keep FLY running and to see which features are actually used.",
  },
  {
    heading: "Your choices",
    body: "You can ask us to delete your account and the data tied to it at any time. Reach out using the contact info below and we'll take care of it.",
  },
  {
    heading: "Children",
    body: "FLY isn't directed at children and we don't knowingly collect data from anyone under 13.",
  },
  {
    heading: "Changes",
    body: "If this policy changes in a meaningful way, we'll update the date below and post the new version here.",
  },
];

function PrivacyModal({ onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(33,29,24,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80, padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#F7F3EA", borderRadius: 14, padding: "26px 28px", width: 520, maxWidth: "100%", maxHeight: "86vh", overflowY: "auto", boxShadow: "0 30px 60px -20px rgba(33,29,24,0.4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 500, margin: 0 }}>Privacy policy</h2>
            <p style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: "#8A8172", margin: "4px 0 0" }}>Last updated {PRIVACY_LAST_UPDATED}</p>
          </div>
          <button className="focus-ring" onClick={onClose} style={{ background: "none", border: "none" }}><X size={18} /></button>
        </div>
        <div style={{ marginTop: 18 }}>
          {PRIVACY_SECTIONS.map((s) => (
            <div key={s.heading} style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#74856A", marginBottom: 5 }}>{s.heading}</div>
              <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0, color: "#211D18" }}>{s.body}</p>
            </div>
          ))}
          <div style={{ marginTop: 4, paddingTop: 14, borderTop: "1px solid #D8D0C0" }}>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#74856A", marginBottom: 5 }}>Contact</div>
            <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0, color: "#211D18" }}>Questions or a deletion request go to {PRIVACY_CONTACT_EMAIL}.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------
   GATEWAY
   The public-facing front door, shown before someone is signed in. Explains
   what FLY does in plain terms and gates the app behind a lightweight sign-in,
   the same shape as LTK's landing flow: explain, then let the person in.
--------------------------------------------------- */
const GATEWAY_FEATURES = [
  { icon: Compass, title: "Discover", body: "Swipe through pieces ranked to your taste. Every like refines what shows up next." },
  { icon: Luggage, title: "Trip planning", body: "Build an itinerary and get a packing list built from the real forecast at each stop." },
  { icon: ShoppingBag, title: "Your closet", body: "Tell FLY what you already own. Trips show what you're missing and what to buy." },
  { icon: Bell, title: "Price watching", body: "Track pieces you're eyeing and get told when the price actually drops." },
];

function Gateway({ onEnter }) {
  const [email, setEmail] = useState("");
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [error, setError] = useState("");

  // Show a one-click "skip" on any non-production host, so the app can be
  // reviewed even if the auto-bypass didn't apply (e.g. ?login was used).
  const allowSkip = (() => {
    try {
      const host = (typeof window !== "undefined" && window.location.hostname) || "";
      return host !== "shopfeellikeyou.com" && host !== "www.shopfeellikeyou.com";
    } catch { return false; }
  })();

  const submit = (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@") || !trimmed.includes(".")) {
      setError("Enter a valid email to continue.");
      return;
    }
    setError("");
    onEnter(trimmed);
  };

  return (
    <div style={{ fontFamily: FONT_BODY, background: "#EDE7DD", minHeight: "100%", color: "#211D18" }}>
      <style>{GLOBAL_STYLES}</style>
      <div style={{ maxWidth: 920, margin: "0 auto", padding: "40px 28px 64px" }}>
        <Logo />

        <div style={{ marginTop: 56, maxWidth: 560 }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#B85C38" }}>style that's actually yours</span>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 40, lineHeight: 1.12, fontWeight: 500, margin: "10px 0 16px" }}>
            The wardrobe that plans your next trip with you.
          </h1>
          <p style={{ fontSize: 15.5, lineHeight: 1.6, color: "#4B463D", margin: 0 }}>
            FLY learns your taste, keeps track of what you own, and turns every trip into a packing list, so it can tell you exactly what's missing before you go.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginTop: 40 }}>
          {GATEWAY_FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} style={{ background: "#F7F3EA", border: "1px solid #D8D0C0", borderRadius: 14, padding: "18px 18px 20px" }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "#211D18", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                  <Icon size={16} color="#EDE7DD" />
                </div>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16.5, fontWeight: 500, marginBottom: 5 }}>{f.title}</div>
                <p style={{ fontSize: 12.5, lineHeight: 1.55, color: "#6B6559", margin: 0 }}>{f.body}</p>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 44, background: "#211D18", borderRadius: 16, padding: "30px 30px 26px", maxWidth: 460 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 500, color: "#EDE7DD", marginBottom: 4 }}>Sign in to start</div>
          <p style={{ fontSize: 12.5, color: "#B8B0A0", margin: "0 0 16px", lineHeight: 1.5 }}>
            Your email keeps your closet and taste profile saved between visits.
          </p>
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              className="focus-ring"
              style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 10, border: "1px solid #4B463D", background: "#2B2620", color: "#EDE7DD", fontSize: 14 }}
            />
            {error && <span style={{ fontSize: 11.5, color: "#E29B7A" }}>{error}</span>}
            <button className="focus-ring" type="submit" style={{ background: "#EDE7DD", color: "#211D18", border: "none", borderRadius: 999, padding: "12px 0", fontSize: 14, fontWeight: 500 }}>
              Continue
            </button>
          </form>
          {allowSkip && (
            <button
              className="focus-ring"
              type="button"
              onClick={() => onEnter("preview@shopfeellikeyou.com")}
              style={{ marginTop: 12, width: "100%", background: "none", border: "1px solid #4B463D", borderRadius: 999, padding: "11px 0", fontSize: 13, color: "#B8B0A0", cursor: "pointer" }}
            >
              Skip and preview the app →
            </button>
          )}
        </div>

        <div style={{ marginTop: 34, paddingTop: 20, borderTop: "1px solid #D8D0C0", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <a href="/about/" style={{ fontSize: 12, color: "#8A8172" }}>About</a>
          <a href="/privacy/" style={{ fontSize: 12, color: "#8A8172" }}>Privacy</a>
          <a href="/affiliate-disclosure/" style={{ fontSize: 12, color: "#8A8172" }}>Affiliate disclosure</a>
          <a href="/terms/" style={{ fontSize: 12, color: "#8A8172" }}>Terms</a>
          <a href="/contact/" style={{ fontSize: 12, color: "#8A8172" }}>Contact</a>
          <a href="/guides/" style={{ fontSize: 12, color: "#8A8172" }}>Packing guides</a>
          <button className="focus-ring" onClick={() => setShowPrivacy(true)} style={{ background: "none", border: "none", padding: 0, fontSize: 12, color: "#8A8172", textDecoration: "underline", cursor: "pointer" }}>
            Quick view
          </button>
        </div>
        <p style={{ marginTop: 14, fontSize: 11.5, lineHeight: 1.5, color: "#9A9284", maxWidth: 560 }}>
          Some links on Feel Like You are affiliate links — if you buy through one we may earn a small commission at no extra cost to you.{" "}
          <a href="/affiliate-disclosure/" style={{ color: "#9A9284" }}>Learn more</a>.
        </p>
      </div>

      {showPrivacy && <PrivacyModal onClose={() => setShowPrivacy(false)} />}
    </div>
  );
}

const TABS = [
  { id: "trip", label: "Trip", icon: Plane },
  { id: "shelf", label: "You", icon: Library },
  { id: "watch", label: "Watch", icon: Bell },
  { id: "board", label: "Discover", icon: Compass },
];

// Taste-profile persistence. The Gateway promises your closet and taste are
// saved between visits — this is the taste half: what you've liked in Discover
// (the signal every recommendation is ranked against), what you're watching,
// and the price-tracking list behind it. Stored as one versioned blob so the
// shape can evolve without choking on stale saves.
const TASTE_STORE_KEY = "fly_taste_v1";
const TASTE_STORE_VERSION = 1;

function loadSavedTaste() {
  try {
    const raw = localStorage.getItem(TASTE_STORE_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (!t || typeof t !== "object" || t.v !== TASTE_STORE_VERSION) return null;
    return t;
  } catch { return null; }
}

// Closet persistence. The closet is no longer tied to a single trip — it's who
// the user is, reused across every trip and shown on their profile. So it gets
// its own store, separate from the trip blob, plus a public/private flag for
// whether the profile shows it to others. Migrates any closet that was saved
// inside an older trip blob so nobody loses what they'd already entered.
const CLOSET_STORE_KEY = "fly_closet_v1";
const CLOSET_STORE_VERSION = 1;

function loadSavedCloset() {
  try {
    const raw = localStorage.getItem(CLOSET_STORE_KEY);
    if (raw) {
      const c = JSON.parse(raw);
      if (c && typeof c === "object" && c.v === CLOSET_STORE_VERSION) {
        // Same re-hydration as trips: refresh each owned piece's static fields
        // (notably `kind`) from the archetype list, keeping how many the user
        // owns and any product they linked. Without this an owned belt saved
        // before `kind` existed still counts as generic "accessories" and would
        // wrongly satisfy a sunglasses or hat row in the packing check.
        const wardrobe = Array.isArray(c.wardrobe)
          ? rehydrateById(c.wardrobe, WARDROBE_ARCHETYPES, ["qty", "product"])
          : [];
        return { wardrobe, public: !!c.public };
      }
    }
    // Migration: pull a wardrobe out of a pre-existing trip blob, if any.
    const legacy = loadSavedTrip();
    if (legacy && Array.isArray(legacy.wardrobe) && legacy.wardrobe.length > 0) {
      return { wardrobe: rehydrateById(legacy.wardrobe, WARDROBE_ARCHETYPES, ["qty", "product"]), public: false };
    }
  } catch {}
  return { wardrobe: [], public: false };
}

// Saved trips — the collection shown on the "You" tab. Distinct from the single
// in-progress trip in fly_trip_v1: this is a list of trips the user has chosen
// to keep. Each entry carries the display fields the trip card needs (title,
// cities, duration, cover) plus a `trip` snapshot of the planner state so the
// trip can be reopened and resumed exactly where it was left.
const SAVED_TRIPS_KEY = "fly_trips_v1";
const SAVED_TRIPS_VERSION = 1;

function loadSavedTrips() {
  try {
    const raw = localStorage.getItem(SAVED_TRIPS_KEY);
    if (!raw) return [];
    const d = JSON.parse(raw);
    if (d && typeof d === "object" && d.v === SAVED_TRIPS_VERSION && Array.isArray(d.trips)) return d.trips;
  } catch {}
  return [];
}

export default function App() {
  const [tab, setTab] = useState("trip");
  // Preview convenience: skip the sign-in gate on any host that ISN'T the live
  // production domain — local dev servers, network IPs, sandbox/preview hosts,
  // file://, etc. — so the whole app can be reviewed without logging in. Only
  // the real domain requires sign-in. Append ?login to force the gate anywhere.
  const previewBypass = (() => {
    try {
      if (typeof window === "undefined") return false;
      if (window.location.search.includes("login")) return false;
      const host = window.location.hostname || "";
      const isProd = host === "shopfeellikeyou.com" || host === "www.shopfeellikeyou.com";
      return !isProd;
    } catch { return false; }
  })();
  // Lightweight sign-in gate. Real auth can replace this later; for now it's
  // enough to give the app a public landing page and a returning-user memory.
  const [userEmail, setUserEmail] = useState(() => {
    try { const stored = localStorage.getItem("fly_email"); if (stored) return stored; } catch {}
    return previewBypass ? "preview@shopfeellikeyou.com" : null;
  });
  // Liked items ARE the style profile now — what used to be manually pinned
  // is now built up by swiping. Downstream screens (trip planner, trip detail)
  // read this as the taste signal. Rehydrate from a prior visit if we have one,
  // otherwise start EMPTY — a brand-new account is a net-new experience with no
  // seeded likes or tracked items. Recommendations fall back to trend picks
  // ("popular picks for you") until the user swipes a real signal.
  const savedTaste = useMemo(loadSavedTaste, []);
  const [liked, setLiked] = useState(savedTaste?.liked ?? []);
  const [watchlist, setWatchlist] = useState(savedTaste?.watchlist ?? []);
  const [tracked, setTracked] = useState(savedTaste?.tracked ?? []);

  // Persist the taste profile whenever it changes, so likes, the watchlist, and
  // price tracking all survive a refresh or a return visit.
  useEffect(() => {
    try {
      localStorage.setItem(
        TASTE_STORE_KEY,
        JSON.stringify({ v: TASTE_STORE_VERSION, liked, watchlist, tracked })
      );
    } catch {}
  }, [liked, watchlist, tracked]);

  // The closet is a top-level, cross-trip concept: the user sets it up once and
  // reuses it on every trip, and it shows on their profile. `closetPublic`
  // controls whether other people can see it there.
  const savedCloset = useMemo(loadSavedCloset, []);
  const [wardrobe, setWardrobe] = useState(savedCloset.wardrobe);
  const [closetPublic, setClosetPublic] = useState(savedCloset.public);
  useEffect(() => {
    try {
      localStorage.setItem(
        CLOSET_STORE_KEY,
        JSON.stringify({ v: CLOSET_STORE_VERSION, wardrobe, public: closetPublic })
      );
    } catch {}
  }, [wardrobe, closetPublic]);

  const [openTrip, setOpenTrip] = useState(null);
  // People + profile navigation live here (not in ShelfScreen) because the
  // trip detail screen is a sibling and also needs to route to a profile.
  const [people, setPeople] = useState(PEOPLE);
  const [openProfile, setOpenProfile] = useState(null);
  const [toast, setToast] = useState(null);

  // Saved trips shown on the "You" tab, persisted independently of the single
  // in-progress trip. plannerKey is bumped to force the trip planner to remount
  // and re-read localStorage when the user reopens a saved trip.
  const [savedTrips, setSavedTrips] = useState(loadSavedTrips);
  const [plannerKey, setPlannerKey] = useState(0);
  useEffect(() => {
    try {
      localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify({ v: SAVED_TRIPS_VERSION, trips: savedTrips }));
    } catch {}
  }, [savedTrips]);

  const pins = liked; // style profile alias for screens that match against taste

  const handleTrackPrice = useCallback((pin) => {
    setTracked((t) => {
      if (t.some((x) => x.title === pin.title && x.store === pin.store)) {
        setToast(`Already tracking "${pin.title}"`);
        return t;
      }
      setToast(`Now tracking "${pin.title}"`);
      return [...t, { id: Date.now(), title: pin.title, store: pin.store, history: [pin.price, pin.price], tag: pin.tag, droppedAt: null, threshold: Math.round(pin.price * 0.85) }];
    });
    setTimeout(() => setToast(null), 2600);
  }, []);

  // Starring an item on the swipe deck adds it to the watchlist AND to price
  // tracking, since "watch this" and "tell me when it drops" are the same intent.
  const handleToggleWatch = useCallback(
    (item) => {
      setWatchlist((w) => {
        const already = w.some((x) => x.id === item.id);
        if (already) {
          setToast(`Removed "${item.title}" from watchlist`);
          setTracked((t) => t.filter((x) => !(x.title === item.title && x.store === item.store)));
          setTimeout(() => setToast(null), 2200);
          return w.filter((x) => x.id !== item.id);
        }
        setToast(`Watching "${item.title}"`);
        setTracked((t) =>
          t.some((x) => x.title === item.title && x.store === item.store)
            ? t
            : [...t, { id: Date.now(), title: item.title, store: item.store, history: [item.was || item.price, item.price], tag: item.tag, color: item.color, imageUrl: item.imageUrl, droppedAt: item.was && item.was > item.price ? "just now" : null, threshold: Math.round(item.price * 0.85) }]
        );
        setTimeout(() => setToast(null), 2200);
        return [...w, item];
      });
    },
    []
  );

  const handleOpenTrip = useCallback((trip) => setOpenTrip(trip), []);
  const handleBackFromTrip = useCallback(() => setOpenTrip(null), []);

  // Opening a profile from anywhere (explore, a luggage card, a trip detail)
  // closes the trip view and lands on the shelf tab showing that person.
  const handleOpenProfile = useCallback((userId) => {
    setOpenTrip(null);
    setOpenProfile(userId);
    setTab("shelf");
  }, []);
  const handleToggleFollow = useCallback(
    (id) => setPeople((p) => p.map((u) => (u.id === id ? { ...u, followed: !u.followed } : u))),
    []
  );


  const goToTab = useCallback((id) => {
    setOpenTrip(null);
    setOpenProfile(null); // don't strand the user on someone else's profile
    setTab(id);
  }, []);

  // Save (or update) a trip into the "You" tab collection. Upserts by id so
  // re-saving an already-saved trip refreshes the same card instead of piling
  // up duplicates.
  const handleSaveTrip = useCallback((snap) => {
    setSavedTrips((list) => {
      const i = list.findIndex((t) => t.id === snap.id);
      if (i >= 0) {
        const copy = [...list];
        copy[i] = snap;
        return copy;
      }
      return [snap, ...list];
    });
    setToast("Trip saved to your You tab");
    setTimeout(() => setToast(null), 2600);
  }, []);

  const handleRemoveSavedTrip = useCallback((id) => {
    setSavedTrips((list) => list.filter((t) => t.id !== id));
  }, []);

  // Reopen a saved trip: drop its snapshot into the in-progress slot the planner
  // reads on mount, then jump to the Trip tab and remount the planner so it
  // hydrates from that snapshot.
  const handleOpenSavedTrip = useCallback((snap) => {
    try {
      localStorage.setItem(
        TRIP_STORE_KEY,
        JSON.stringify({ v: TRIP_STORE_VERSION, ...snap.trip, savedTripId: snap.id })
      );
    } catch {}
    setOpenTrip(null);
    setOpenProfile(null);
    setTab("trip");
    setPlannerKey((k) => k + 1);
  }, []);

  if (!userEmail) {
    return (
      <Gateway
        onEnter={(email) => {
          try { localStorage.setItem("fly_email", email); } catch {}
          setUserEmail(email);
        }}
      />
    );
  }

  return (
    <div style={{ fontFamily: FONT_BODY, background: "#EDE7DD", minHeight: "100%", color: "#211D18" }}>
      <style>{GLOBAL_STYLES}</style>

      {/* Brand + tab bar */}
      <div style={{ background: "#EDE7DD", position: "sticky", top: 0, zIndex: 20, borderBottom: "1px solid #D8D0C0" }}>
        <div style={{ padding: "16px 32px 0" }}>
          <Logo />
        </div>
        <nav style={{ display: "flex", gap: 4, padding: "8px 32px 0" }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id && !openTrip;
          return (
            <button
              key={t.id}
              className="nav-tab focus-ring"
              onClick={() => goToTab(t.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "10px 16px",
                borderRadius: "10px 10px 0 0",
                border: "none",
                borderBottom: active ? "2px solid #211D18" : "2px solid transparent",
                background: active ? "#F7F3EA" : "transparent",
                color: active ? "#211D18" : "#8A8172",
                fontSize: 13,
                fontWeight: active ? 500 : 400,
              }}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </nav>
      </div>

      {/* Screens */}
      {openTrip ? (
        <TripDetailScreen
          trip={openTrip}
          pins={pins}
          onBack={handleBackFromTrip}
          author={authorOfTrip(openTrip, people)}
          onOpenAuthor={handleOpenProfile}
        />
      ) : tab === "board" ? (
        // Discover is built (DiscoverScreen) but gated until a real product feed
        // is wired — the taste engine is only meaningful with real products to
        // swipe on. Swap the ComingSoon line back to <DiscoverScreen …/> to ship it.
        <ComingSoon
          icon={Compass}
          title="Discover your taste"
          description="A swipe feed that learns what you love. Like the pieces that feel like you and skip the ones that don't — FLY builds a picture of your style so every trip's packing and shopping picks are chosen for you, not generic."
          points={[
            "Swipe through real, shoppable pieces to teach FLY your taste.",
            "The more you swipe, the sharper your recommendations get.",
            "Your style then shapes what each trip suggests you pack and buy.",
          ]}
        />
      ) : tab === "watch" ? (
        // Watch (WatchScreen) is gated until live pricing exists — it promises
        // price-drop alerts it can't deliver without a real feed. Swap back to
        // <WatchScreen …/> once prices are live.
        <ComingSoon
          icon={Bell}
          title="Watch the pieces you love"
          description="Save the items you're not ready to buy yet and let FLY keep an eye on them. When a piece you're watching drops in price, you'll get a nudge — so you buy at the right moment instead of guessing."
          points={[
            "Save pieces from Discover and your trips to a watchlist.",
            "FLY tracks their prices in the background.",
            "Get alerted the moment something you want goes on sale.",
          ]}
        />
      ) : tab === "trip" ? (
        <TripPlannerScreen key={plannerKey} pins={pins} wardrobe={wardrobe} setWardrobe={setWardrobe} onSaveTrip={handleSaveTrip} />
      ) : (
        <ShelfScreen
          liked={liked}
          savedTrips={savedTrips}
          onOpenSavedTrip={handleOpenSavedTrip}
          onRemoveSavedTrip={handleRemoveSavedTrip}
          onGoTo={goToTab}
          wardrobe={wardrobe}
          setWardrobe={setWardrobe}
          closetPublic={closetPublic}
          setClosetPublic={setClosetPublic}
        />
      )}

      {/* Global footer — persistent affiliate disclosure + policy links, shown
          under every screen (including those with shoppable buttons). */}
      <footer style={{ borderTop: "1px solid #D8D0C0", padding: "22px 32px 32px", marginTop: 8 }}>
        <p style={{ fontSize: 11.5, lineHeight: 1.5, color: "#8A8172", margin: "0 0 12px", maxWidth: 620 }}>
          Some links on Feel Like You are affiliate links — if you buy through one we may earn a small commission at no extra cost to you.{" "}
          <a href="/affiliate-disclosure/" style={{ color: "#74856A" }}>Learn more</a>.
        </p>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <a href="/about/" style={{ fontSize: 12, color: "#8A8172" }}>About</a>
          <a href="/privacy/" style={{ fontSize: 12, color: "#8A8172" }}>Privacy</a>
          <a href="/affiliate-disclosure/" style={{ fontSize: 12, color: "#8A8172" }}>Affiliate disclosure</a>
          <a href="/terms/" style={{ fontSize: 12, color: "#8A8172" }}>Terms</a>
          <a href="/contact/" style={{ fontSize: 12, color: "#8A8172" }}>Contact</a>
          <a href="/guides/" style={{ fontSize: 12, color: "#8A8172" }}>Packing guides</a>
          <span style={{ fontSize: 12, color: "#B0A996" }}>© Feel Like You</span>
        </div>
      </footer>

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#211D18",
            color: "#EDE7DD",
            padding: "10px 18px",
            borderRadius: 999,
            fontSize: 13,
            boxShadow: "0 12px 24px -10px rgba(33,29,24,0.4)",
            zIndex: 60,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
