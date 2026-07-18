import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  Plus, X, Sparkles, Tag, ExternalLink,
  Bell, Store, ChevronDown, Check, BellOff,
  Cloud, CloudRain, Sun, CloudSun, MapPin, Luggage, ChevronRight, ShoppingBag,
  Heart, ArrowLeft, HelpCircle, Plane, Library, Search,
  Star, RotateCcw, Compass,
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

  const sameStoreCount = board.filter((p) => p.store === item.store).length;
  if (sameStoreCount > 0) {
    factors.push({ detail: `you already like ${item.store}`, weight: 0.7 });
    total += 0.7;
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
  { id: 1, title: "Waffle-knit crewneck", store: "Arket", price: 68, color: "#C4A5A0", tag: "knitwear", h: 260, tilt: -2 },
  { id: 2, title: "Wide-leg wool trouser", store: "COS", price: 145, color: "#3E4A3D", tag: "tailoring", h: 320, tilt: 1.5 },
  { id: 3, title: "Suede desert boot", store: "Clarks", price: 130, color: "#8C6A5B", tag: "footwear", h: 230, tilt: -1 },
  { id: 4, title: "Brushed wool overshirt", store: "Toast", price: 175, color: "#5B6B8C", tag: "outerwear", h: 300, tilt: 2 },
  { id: 5, title: "Cable-knit scarf", store: "Uniqlo", price: 35, color: "#A8785B", tag: "accessory", h: 200, tilt: -1.5 },
  { id: 6, title: "Straight denim, raw hem", store: "Levi's", price: 98, color: "#5B6B8C", tag: "denim", h: 280, tilt: 1 },
];

const CATALOG = [
  { id: "r1", title: "Merino turtleneck", store: "Everlane", price: 88, was: 88, color: "#3E4A3D", tag: "knitwear", category: "knitwear" },
  { id: "r2", title: "Corduroy trucker jacket", store: "Madewell", price: 118, was: 148, color: "#A8785B", tag: "outerwear", category: "outerwear" },
  { id: "r3", title: "Pleated wool skirt", store: "COS", price: 120, was: 120, color: "#8C6A5B", tag: "tailoring", category: "tailoring" },
  { id: "r4", title: "Suede chelsea boot", store: "Clarks", price: 150, was: 190, color: "#5B6B8C", tag: "footwear", category: "footwear" },
  { id: "r5", title: "Alpaca-blend beanie", store: "Toast", price: 42, was: 42, color: "#C4A5A0", tag: "accessory", category: "accessory" },
  { id: "r6", title: "Selvedge denim jacket", store: "Levi's", price: 148, was: 148, color: "#3E4A3D", tag: "denim", category: "denim" },
  { id: "r7", title: "Ribbed wool cardigan", store: "Arket", price: 95, was: 120, color: "#C79A44", tag: "knitwear", category: "knitwear" },
  { id: "r8", title: "Tapered flannel trouser", store: "Uniqlo", price: 60, was: 60, color: "#5B6B8C", tag: "tailoring", category: "tailoring" },
  { id: "r9", title: "Shearling collar coat", store: "Toast", price: 310, was: 310, color: "#8C6A5B", tag: "outerwear", category: "outerwear" },
  { id: "r10", title: "Suede loafer", store: "Clarks", price: 140, was: 175, color: "#A8785B", tag: "footwear", category: "footwear" },
  { id: "r11", title: "Cropped wool blazer", store: "COS", price: 165, was: 165, color: "#3E4A3D", tag: "tailoring", category: "tailoring" },
  { id: "r12", title: "Cashmere crewneck", store: "Everlane", price: 128, was: 160, color: "#C4A5A0", tag: "knitwear", category: "knitwear" },
  { id: "r13", title: "Wool felt beret", store: "Arket", price: 38, was: 38, color: "#8C6A5B", tag: "accessory", category: "accessory" },
  { id: "r14", title: "Straight-leg cord trouser", store: "Madewell", price: 88, was: 88, color: "#A8785B", tag: "tailoring", category: "tailoring" },
  { id: "r15", title: "Sherpa-lined denim jacket", store: "Levi's", price: 168, was: 198, color: "#5B6B8C", tag: "denim", category: "denim" },
  { id: "r16", title: "Leather ankle boot", store: "Clarks", price: 175, was: 175, color: "#3E4A3D", tag: "footwear", category: "footwear" },
  { id: "p1", title: "Packable rain shell", store: "Arket", price: 98, was: 98, color: "#3E4A3D", tag: "raincoat", category: "raincoat" },
  { id: "p2", title: "Waxed cotton rain jacket", store: "Toast", price: 165, was: 195, color: "#5B6B8C", tag: "raincoat", category: "raincoat" },
  { id: "p3", title: "Lightweight anorak", store: "COS", price: 89, was: 89, color: "#8C6A5B", tag: "raincoat", category: "raincoat" },
  { id: "p4", title: "Technical rain jacket", store: "Uniqlo", price: 59, was: 59, color: "#5B6B8C", tag: "raincoat", category: "raincoat" },
  { id: "p11", title: "Ribbed swim short", store: "COS", price: 55, was: 55, color: "#3E4A3D", tag: "swimwear", category: "swimwear" },
  { id: "p12", title: "Textured one-piece", store: "Arket", price: 68, was: 85, color: "#C4A5A0", tag: "swimwear", category: "swimwear" },
  { id: "p13", title: "Linen camp shirt", store: "Toast", price: 88, was: 88, color: "#A8785B", tag: "shirt", category: "shirt" },
  { id: "p14", title: "Cotton poplin shirt", store: "Everlane", price: 68, was: 68, color: "#5B6B8C", tag: "shirt", category: "shirt" },
  { id: "c3", title: "Reversible leather belt", store: "Everlane", price: 65, was: 65, color: "#8C6A5B", tag: "accessory", category: "accessory" },
  { id: "c4", title: "Woven canvas belt", store: "Madewell", price: 38, was: 48, color: "#A8785B", tag: "accessory", category: "accessory" },
];

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
  return (data.products || []).map((p) => ({
    ...p,
    // Feed colour names are free text ("olive green"); resolve to a hex the
    // matching engine can score against, neutral grey when unknown.
    color: resolveColour(p.colorName || ""),
    tag: p.category,
  }));
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

const STARTER_SUGGESTED = [
  { id: "s1", label: "Linen shirts", reason: "for warm days", packed: true, category: "shirt", perDays: 2, qtyMin: 2, qtyMax: 8, scope: "all" },
  { id: "s2", label: "Light rain jacket", reason: "in case of rain", packed: false, category: "raincoat" },
  { id: "s3", label: "Layer for evenings", reason: "for cooler evenings", packed: false, category: "knitwear", perDays: 5, qtyMin: 1, qtyMax: 3, scope: "all" },
  { id: "s4", label: "Comfortable walking shoes", reason: "cobblestone cities, daily walking", packed: true, category: "footwear" },
  { id: "s5", label: "Sunglasses", reason: "for sunny days", packed: true, category: "accessory" },
  { id: "s6", label: "Swimwear", reason: "for coastal stops", packed: false, category: "swimwear", perDays: 3, qtyMin: 1, qtyMax: 3, scope: "coastal" },
  { id: "s7", label: "Compact umbrella", reason: "in case of rain", packed: false, category: null },
  { id: "s8", label: "Light scarf", reason: "for cooler mornings", packed: false, category: "accessory" },
  { id: "s9", label: "Pairs of socks", reason: "one per day plus a spare", packed: false, category: null, perDays: 1, qtyMin: 3, qtyMax: 16, scope: "all" },
  { id: "s10", label: "Underwear", reason: "one per day plus a spare", packed: false, category: null, perDays: 1, qtyMin: 3, qtyMax: 16, scope: "all" },
];

const STARTER_OTHER = [
  { id: "o1", label: "Passport + boarding passes", packed: true, category: null },
  { id: "o2", label: "Phone charger + adapter", packed: true, category: null },
  { id: "o3", label: "Toiletries bag", packed: false, category: null },
  { id: "o4", label: "Medication", packed: false, category: null },
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
  { id: "l5", label: "Vintage silk scarf", tagged: false, color: "#C79A44", category: "accessory" },
  { id: "l7", label: "Woven leather belt", tagged: false, color: "#8C6A5B", category: "accessory" },
  { id: "l8", label: "Linen button-down", tagged: false, color: "#A8785B", category: "shirt" },
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

// Renders a real product photo when imageUrl is set and loads successfully;
// falls back to the colour-swatch gradient otherwise (missing URL, broken
// link, or still-mocked catalog data). This is the single place image
// fallback logic lives, so every card in the app behaves consistently.
function ProductVisual({ imageUrl, imageFallback, color, height, radius = 6 }) {
  const [stage, setStage] = useState(0); // 0 = primary, 1 = fallback, 2 = swatch
  // Feed products give two images: the merchant's own CDN (full resolution) and
  // Awin's resizer (200px, letterboxed). Prefer the merchant's, fall back to
  // Awin's if it fails, then to a colour swatch. Reset if the URL changes so a
  // failed image doesn't poison the next card.
  useEffect(() => { setStage(0); }, [imageUrl, imageFallback]);

  const src = stage === 0 ? imageUrl : stage === 1 ? imageFallback : null;
  const usable = src && String(src).trim();

  if (usable) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setStage((s) => s + 1)}
        style={{ width: "100%", height, borderRadius: radius, objectFit: "cover", display: "block", background: `${color}33` }}
      />
    );
  }
  return <div style={{ height, borderRadius: radius, background: `linear-gradient(160deg, ${color}, ${color}CC)` }} />;
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
          <ProductVisual imageUrl={item.imageUrl} imageFallback={item.imageFallback} color={item.color} height={42} />
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
        {item.sourceUrl && (
          <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="focus-ring" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#74856A", textDecoration: "none", flexShrink: 0 }}>
            view <ExternalLink size={9} />
          </a>
        )}
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

const DISCOVER_CATEGORIES = ["all", "dresses", "knitwear", "outerwear", "footwear", "denim", "tailoring", "bags", "accessory", "shirt", "swimwear"];

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
                      <ProductVisual imageUrl={item.imageUrl} imageFallback={item.imageFallback} color={item.color} height={80} />
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
          <ProductVisual imageUrl={item.imageUrl} imageFallback={item.imageFallback} color={item.color} height="100%" radius={0} />
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
          {/* Affiliate link — must be the tracked aw_deep_link, or the click
              earns nothing. Stops propagation so it doesn't trigger a swipe. */}
          {item.sourceUrl && (
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noopener noreferrer sponsored"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="focus-ring"
              aria-label={`View ${item.title} at ${item.store}`}
              style={{ display: "flex", alignItems: "center", gap: 4, background: "#211D18", color: "#EDE7DD", borderRadius: 999, padding: "6px 11px", fontSize: 11, textDecoration: "none" }}
            >
              View <ExternalLink size={10} />
            </a>
          )}
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
                    <ProductVisual imageUrl={item.imageUrl} imageFallback={item.imageFallback} color={item.color || "#8A8172"} height={52} />
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
function recommendFor(item, conditions, legs, tripDays) {
  const coastalDays = legs.filter((l) => l.coastal).reduce((s, l) => s + (l.nights || 0), 0);

  // No weather yet — show the item with a neutral reason rather than hiding it.
  if (!conditions) {
    const qty = item.perDays ? Math.min(item.qtyMax, Math.max(item.qtyMin, Math.ceil(tripDays / item.perDays))) : null;
    return { show: true, qty, reason: item.reason };
  }

  const { maxHi, minLo, rainDays, sunDays } = conditions;

  switch (item.id) {
    case "s1": // linen shirts — warm weather
      if (maxHi < 18) return { show: false };
      return { show: true, qty: Math.min(8, Math.max(2, Math.ceil(tripDays / 2))), reason: `warm days up to ${maxHi}°C` };

    case "s2": // rain jacket
      if (rainDays === 0) return { show: false };
      return { show: true, qty: null, reason: `rain forecast on ${rainDays} ${rainDays === 1 ? "day" : "days"}` };

    case "s3": // evening layer
      if (minLo > 18) return { show: false };
      return { show: true, qty: Math.min(3, Math.max(1, Math.ceil(tripDays / 5))), reason: `lows around ${minLo}°C` };

    case "s4": // walking shoes
      return { show: true, qty: null, reason: "daily walking" };

    case "s5": // sunglasses
      if (sunDays === 0) return { show: false };
      return { show: true, qty: null, reason: `sun on ${sunDays} ${sunDays === 1 ? "day" : "days"}` };

    case "s6": // swimwear
      if (coastalDays === 0) return { show: false };
      if (maxHi < 20) return { show: false };
      return { show: true, qty: Math.min(3, Math.max(1, Math.ceil(coastalDays / 3))), reason: `${coastalDays} coastal ${coastalDays === 1 ? "day" : "days"}, up to ${maxHi}°C` };

    case "s7": // umbrella
      if (rainDays === 0) return { show: false };
      return { show: true, qty: null, reason: `rain on ${rainDays} ${rainDays === 1 ? "day" : "days"}` };

    case "s8": // light scarf
      if (minLo > 15) return { show: false };
      return { show: true, qty: null, reason: `cooler mornings around ${minLo}°C` };

    case "s9": // socks
    case "s10": // underwear
      return { show: true, qty: Math.min(16, Math.max(3, tripDays + 1)), reason: `one per day plus a spare · ${tripDays} days` };

    default: {
      const qty = item.perDays ? Math.min(item.qtyMax, Math.max(item.qtyMin, Math.ceil(tripDays / item.perDays))) : null;
      return { show: true, qty, reason: item.reason };
    }
  }
}

function shopMatchesFor(category, pins) {
  if (!category || pins.length === 0) return [];
  return CATALOG.filter((c) => c.category === category)
    .map((item) => ({ item, ...scoreAgainstBoard(item, pins, null) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 4);
}

function TripPlannerScreen({ pins }) {
  const [countries, setCountries] = useState(STARTER_COUNTRIES);
  const [startDate, setStartDate] = useState(DEMO_START);
  const [endDate, setEndDate] = useState(DEMO_END);
  const [legs, setLegs] = useState(STARTER_LEGS);
  const [activeKey, setActiveKey] = useState(null); // 'leg:<id>' | 'country:<id>'

  const [suggested, setSuggested] = useState(STARTER_SUGGESTED);
  const [other, setOther] = useState(STARTER_OTHER);
  const [newItem, setNewItem] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [shopItem, setShopItem] = useState(null);
  const [showItinerary, setShowItinerary] = useState(false);

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
  const [manualSplit, setManualSplit] = useState(false);
  useEffect(() => {
    if (manualSplit || countries.length === 0) return;
    const split = evenSplit(tripDays, countries.length);
    setCountries((cs) => cs.map((c, i) => ({ ...c, nights: split[i] })));
  }, [tripDays, countries.length, manualSplit]);

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

  // Keep the active segment valid as the timeline changes.
  useEffect(() => {
    if (timeline.length === 0) { setActiveKey(null); return; }
    if (!activeKey || !timeline.some((t) => t.key === activeKey)) setActiveKey(timeline[0].key);
  }, [timeline, activeKey]);

  const active = timeline.find((t) => t.key === activeKey) || timeline[0] || null;

  const wKey = active ? `${active.key}:${active.start}:${active.end}` : null;
  useEffect(() => {
    if (!active || !wKey || active.lat == null) return;
    if (weather[wKey]) return;
    let cancelled = false;
    setWeather((w) => ({ ...w, [wKey]: "loading" }));
    fetchWeather(active.lat, active.lon, active.start, active.end)
      .then((d) => { if (!cancelled) setWeather((w) => ({ ...w, [wKey]: d })); })
      .catch(() => { if (!cancelled) setWeather((w) => ({ ...w, [wKey]: "error" })); });
    return () => { cancelled = true; };
  }, [active, wKey, weather]);

  const current = wKey ? weather[wKey] : null;
  const weatherDays = current && current !== "loading" && current !== "error" ? current.days : [];

  // Packing reads the WHOLE trip, not just the active segment — you pack once.
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
  const allItems = [...suggested, ...other];
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
      coastal: false,
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
  const toggleLegCoastal = (id) => setLegs((ls) => ls.map((l) => (l.id === id ? { ...l, coastal: !l.coastal } : l)));
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

  const shopMatches = useMemo(() => (shopItem ? shopMatchesFor(shopItem.category, pins) : []), [shopItem, pins]);

  const tripTitle = countries.length === 0
    ? "Your trip"
    : countries.length === 1
    ? countries[0].name
    : countries.length === 2
    ? `${countries[0].name} & ${countries[1].name}`
    : `${countries.slice(0, -1).map((c) => c.name).join(", ")} & ${countries[countries.length - 1].name}`;

  const assignedNights = timeline.reduce((s, t) => s + t.nights, 0);
  const unassigned = tripDays - assignedNights;

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
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: FONT_MONO, fontSize: 22, fontWeight: 500 }}>{packedCount}<span style={{ color: "#8A8172" }}>/{allItems.length}</span></div>
            <div style={{ fontSize: 11, color: "#8A8172" }}>packed</div>
          </div>
        </div>

        {timeline.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginTop: 22, flexWrap: "wrap" }}>
            {timeline.map((t) => (
              <button key={t.key} className="nav-tab focus-ring" onClick={() => setActiveKey(t.key)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 999, border: "1px solid " + (activeKey === t.key ? "#211D18" : "#D8D0C0"), background: activeKey === t.key ? "#211D18" : "transparent", color: activeKey === t.key ? "#EDE7DD" : "#211D18", fontSize: 13 }}>
                <MapPin size={12} />
                {t.label}
                {t.approximate && <span style={{ fontSize: 9, opacity: 0.7 }}>~</span>}
              </button>
            ))}
          </div>
        )}
      </header>

      <div style={{ padding: "26px 32px 60px", maxWidth: 820 }}>
        {/* weather */}
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
          ) : current === "loading" ? (
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
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
            <CloudSun size={14} color="#B85C38" />
            <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#B85C38" }}>suggested for this trip</span>
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
              return (
                <div key={item.id} className="item-row" onClick={() => item.category && setShopItem(item)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px", borderBottom: idx < suggested.length - 1 ? "1px solid #E4DDCE" : "none", cursor: item.category ? "pointer" : "default" }}>
                  <div className="checkbox focus-ring" role="checkbox" tabIndex={0} aria-checked={item.packed} aria-label={`Mark ${item.label} as ${item.packed ? "not packed" : "packed"}`} onClick={(e) => { e.stopPropagation(); toggleSuggested(item.id); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); toggleSuggested(item.id); } }} style={{ width: 20, height: 20, borderRadius: 6, border: "1.5px solid " + (item.packed ? "#74856A" : "#C9BFA9"), background: item.packed ? "#74856A" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {item.packed && <Check size={13} color="#F7F3EA" />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, opacity: item.packed ? 0.55 : 1, textDecoration: item.packed ? "line-through" : "none" }}>
                      {item.label}
                      {rec.qty !== null && <span style={{ fontFamily: FONT_MONO, color: "#8A8172", fontWeight: 400, marginLeft: 6 }}>×{rec.qty}</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: "#8A8172", marginTop: 2 }}>{rec.reason}</div>
                  </div>
                  {item.category && <ShoppingBag size={15} color="#8A8172" style={{ flexShrink: 0 }} />}
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <Luggage size={14} color="#74856A" />
              <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#74856A" }}>everything else</span>
            </div>
            <button className="focus-ring" onClick={() => setShowAdd(true)} style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#211D18", fontSize: 12.5, padding: "4px 6px" }}>
              <Plus size={13} /> add item
            </button>
          </div>
          <div style={{ background: "#F7F3EA", borderRadius: 12, overflow: "hidden", border: "1px solid #D8D0C0" }}>
            {other.map((item, idx) => (
              <div key={item.id} className="item-row" style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px", borderBottom: idx < other.length - 1 ? "1px solid #E4DDCE" : "none" }}>
                <div className="checkbox focus-ring" role="checkbox" tabIndex={0} aria-checked={item.packed} aria-label={`Mark ${item.label} as ${item.packed ? "not packed" : "packed"}`} onClick={() => toggleOther(item.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleOther(item.id); }} style={{ width: 20, height: 20, borderRadius: 6, border: "1.5px solid " + (item.packed ? "#74856A" : "#C9BFA9"), background: item.packed ? "#74856A" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {item.packed && <Check size={13} color="#F7F3EA" />}
                </div>
                <div style={{ flex: 1, fontSize: 13.5, fontWeight: 500, opacity: item.packed ? 0.55 : 1, textDecoration: item.packed ? "line-through" : "none" }}>{item.label}</div>
              </div>
            ))}
            {other.length === 0 && <div style={{ padding: "20px 16px", textAlign: "center", fontSize: 13, color: "#8A8172" }}>Nothing here yet.</div>}
          </div>
        </section>
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
                              <button className="focus-ring" onClick={() => toggleLegCoastal(l.id)} style={{ marginTop: 3, background: l.coastal ? "#74856A" : "transparent", color: l.coastal ? "#F7F3EA" : "#8A8172", border: "1px solid " + (l.coastal ? "#74856A" : "#D8D0C0"), borderRadius: 999, padding: "1px 8px", fontSize: 9.5, fontFamily: FONT_MONO }}>
                                {l.coastal ? "coastal" : "mark coastal"}
                              </button>
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
              <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "#B85C38" }}>matched to your style</span>
            </div>
            <p style={{ fontSize: 11.5, color: "#8A8172", margin: "4px 0 16px", lineHeight: 1.5 }}>Ranked using the colours, price range, and stores you've liked.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {shopMatches.map(({ item, factors }, i) => <MatchCard key={item.id} item={item} factors={factors} index={i} />)}
              {shopMatches.length === 0 && (
                <div style={{ fontSize: 12.5, color: "#8A8172" }}>
                  {pins.length === 0 ? "Like a few pieces in Discover first, so matches can be ranked to your style." : "Nothing matching this yet."}
                </div>
              )}
            </div>
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

function LuggageCard({ trip, onOpen, onOpenAuthor, author, compact = false }) {
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
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#8A8172" }}>
            <Heart size={10} /> {trip.likes}
          </span>
        </div>
      </div>
    </div>
  );
}

function ShelfScreen({ liked, onOpenTrip, people, onToggleFollow, openProfile, setOpenProfile }) {
  const [view, setView] = useState("me"); // me | explore
  const [section, setSection] = useState("luggages"); // luggages | liked | people
  const [peopleTab, setPeopleTab] = useState("followers"); // followers | following
  const [query, setQuery] = useState("");

  const toggleFollow = onToggleFollow;

  // One search across both people and places — users shouldn't have to pick a
  // mode first. Matches names/handles/bios for people, and titles/cities for
  // trips, so "lisbon" surfaces trips and "marta" surfaces people.
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const matchedPeople = useMemo(() => {
    if (!searching) return people;
    return people.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.handle.toLowerCase().includes(q) ||
        u.bio.toLowerCase().includes(q)
    );
  }, [people, q, searching]);

  const matchedTrips = useMemo(() => {
    if (!searching) return TRIPS_LIBRARY;
    return TRIPS_LIBRARY.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.author.toLowerCase().includes(q) ||
        t.cities.some((c) => c.toLowerCase().includes(q))
    );
  }, [q, searching]);

  const noResults = searching && matchedPeople.length === 0 && matchedTrips.length === 0;

  const authorOf = useCallback((trip) => authorOfTrip(trip, people), [people]);

  // My luggages — in a real build these are trips the user saved. Using the
  // first library trip as a stand-in so the profile isn't empty.
  const myTrips = useMemo(() => TRIPS_LIBRARY.slice(0, 2), []);

  const followingList = useMemo(() => people.filter((p) => p.followed), [people]);
  const followersList = useMemo(() => people.slice(0, 3), [people]); // mock

  const profileUser = openProfile ? people.find((p) => p.id === openProfile) : null;
  const profileTrips = profileUser ? TRIPS_LIBRARY.filter((t) => profileUser.trips.includes(t.id)) : [];

  // ---- viewing someone else's profile ----
  if (profileUser) {
    return (
      <div>
        <header style={{ padding: "22px 32px 20px", borderBottom: "1px solid #D8D0C0" }}>
          <button className="focus-ring" onClick={() => setOpenProfile(null)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#8A8172", fontSize: 12.5, padding: 0, marginBottom: 18 }}>
            <ArrowLeft size={14} /> back
          </button>

          <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
            <Avatar color={profileUser.avatar} name={profileUser.name} size={62} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 500, fontSize: 26, margin: "0 0 2px" }}>{profileUser.name}</h1>
              <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: "#8A8172", marginBottom: 8 }}>{profileUser.handle}</div>
              <p style={{ fontSize: 13, color: "#211D18", margin: "0 0 10px", lineHeight: 1.5 }}>{profileUser.bio}</p>
              <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#8A8172" }}>
                <span><strong style={{ color: "#211D18" }}>{profileUser.followers.toLocaleString()}</strong> followers</span>
                <span><strong style={{ color: "#211D18" }}>{profileUser.following}</strong> following</span>
                <span><strong style={{ color: "#211D18" }}>{profileTrips.length}</strong> luggages</span>
              </div>
            </div>
            <button
              className="focus-ring"
              onClick={() => toggleFollow(profileUser.id)}
              style={{
                background: profileUser.followed ? "transparent" : "#211D18",
                color: profileUser.followed ? "#211D18" : "#EDE7DD",
                border: profileUser.followed ? "1px solid #D8D0C0" : "none",
                borderRadius: 999,
                padding: "9px 20px",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {profileUser.followed ? "Following" : "Follow"}
            </button>
          </div>
        </header>

        <div style={{ padding: "24px 32px 60px" }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#74856A", marginBottom: 14 }}>
            luggages
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
            {profileTrips.map((t) => <LuggageCard key={t.id} trip={t} onOpen={onOpenTrip} />)}
          </div>
        </div>
      </div>
    );
  }

  // ---- my profile / explore ----
  return (
    <div>
      <header style={{ padding: "24px 32px 0", borderBottom: "1px solid #D8D0C0" }}>
        {/* view switch */}
        <div style={{ display: "flex", gap: 6, marginBottom: 22 }}>
          {[
            { id: "me", label: "My shelf" },
            { id: "explore", label: "Explore" },
          ].map((v) => (
            <button
              key={v.id}
              className="focus-ring"
              onClick={() => setView(v.id)}
              style={{
                padding: "7px 14px",
                borderRadius: 999,
                border: "1px solid " + (view === v.id ? "#211D18" : "#D8D0C0"),
                background: view === v.id ? "#211D18" : "transparent",
                color: view === v.id ? "#EDE7DD" : "#211D18",
                fontSize: 12.5,
              }}
            >
              {v.label}
            </button>
          ))}
        </div>

        {view === "me" && (
          <>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
              <Avatar color={ME.avatar} name={ME.name} size={62} />
              <div style={{ flex: 1, minWidth: 200 }}>
                <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 500, fontSize: 28, margin: "0 0 2px" }}>{ME.name}</h1>
                <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: "#8A8172", marginBottom: 8 }}>{ME.handle}</div>
                <p style={{ fontSize: 13, margin: "0 0 10px", lineHeight: 1.5 }}>{ME.bio}</p>
                <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#8A8172" }}>
                  <span><strong style={{ color: "#211D18" }}>{ME.followers}</strong> followers</span>
                  <span><strong style={{ color: "#211D18" }}>{ME.following}</strong> following</span>
                  <span><strong style={{ color: "#211D18" }}>{myTrips.length}</strong> luggages</span>
                </div>
              </div>
            </div>

            {/* section tabs */}
            <div style={{ display: "flex", gap: 20 }}>
              {[
                { id: "luggages", label: `Luggages (${myTrips.length})` },
                { id: "liked", label: `Liked (${liked.length})` },
                { id: "people", label: "People" },
              ].map((s) => (
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
          </>
        )}
        {view === "explore" && (
          <div style={{ position: "relative", maxWidth: 460, marginBottom: 20 }}>
            <Search size={15} color="#8A8172" style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
            <input
              className="focus-ring"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people or places — try “Lisbon” or a name"
              aria-label="Search people or places"
              style={{
                width: "100%",
                padding: "10px 36px 10px 36px",
                borderRadius: 999,
                border: "1px solid #D8D0C0",
                fontSize: 13.5,
                background: "#F7F3EA",
                color: "#211D18",
              }}
            />
            {searching && (
              <button
                aria-label="Clear search"
                className="focus-ring"
                onClick={() => setQuery("")}
                style={{
                  position: "absolute",
                  right: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  padding: 4,
                  display: "flex",
                  color: "#8A8172",
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}
      </header>

      <div style={{ padding: "24px 32px 60px" }}>
        {view === "explore" ? (
          noResults ? (
            <div style={{ border: "1.5px dashed #C9BFA9", borderRadius: 14, padding: "48px 24px", textAlign: "center", color: "#8A8172", fontSize: 13.5 }}>
              Nothing matching “{query}”. Try a city, a country, or someone's name.
            </div>
          ) : (
          <>
            {matchedPeople.length > 0 && (
              <>
                <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#74856A", marginBottom: 4 }}>
                  {searching ? `people · ${matchedPeople.length}` : "people to follow"}
                </div>
                {!searching && (
                  <p style={{ fontSize: 12.5, color: "#8A8172", margin: "4px 0 18px" }}>
                    Travellers whose packing you might like.
                  </p>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 34, marginTop: searching ? 14 : 0 }}>
                  {matchedPeople.map((u) => (
                <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 13, background: "#F7F3EA", border: "1px solid #E4DDCE", borderRadius: 10, padding: "12px 14px" }}>
                  <button className="focus-ring" onClick={() => setOpenProfile(u.id)} style={{ background: "none", border: "none", padding: 0, display: "flex" }}>
                    <Avatar color={u.avatar} name={u.name} size={42} />
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <button className="focus-ring" onClick={() => setOpenProfile(u.id)} style={{ background: "none", border: "none", padding: 0, textAlign: "left", fontSize: 13.5, fontWeight: 500, color: "#211D18" }}>
                      {u.name}
                    </button>
                    <div style={{ fontSize: 11.5, color: "#8A8172", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.bio}</div>
                  </div>
                  <button
                    className="focus-ring"
                    onClick={() => toggleFollow(u.id)}
                    style={{
                      background: u.followed ? "transparent" : "#211D18",
                      color: u.followed ? "#211D18" : "#EDE7DD",
                      border: u.followed ? "1px solid #D8D0C0" : "none",
                      borderRadius: 999,
                      padding: "7px 16px",
                      fontSize: 12,
                      flexShrink: 0,
                    }}
                  >
                    {u.followed ? "Following" : "Follow"}
                  </button>
                </div>
              ))}
                </div>
              </>
            )}

            {matchedTrips.length > 0 && (
              <>
                <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#74856A", marginBottom: 14 }}>
                  {searching ? `luggages · ${matchedTrips.length}` : "luggages to explore"}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
                  {matchedTrips.map((t) => (
                    <LuggageCard
                      key={t.id}
                      trip={t}
                      onOpen={onOpenTrip}
                      author={authorOf(t)}
                      onOpenAuthor={setOpenProfile}
                    />
                  ))}
                </div>
              </>
            )}
          </>
          )
        ) : section === "luggages" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
            {myTrips.map((t) => <LuggageCard key={t.id} trip={t} onOpen={onOpenTrip} />)}
          </div>
        ) : section === "liked" ? (
          liked.length === 0 ? (
            <div style={{ border: "1.5px dashed #C9BFA9", borderRadius: 14, padding: "44px 24px", textAlign: "center", color: "#8A8172", fontSize: 13.5 }}>
              Nothing liked yet. Swipe through Discover to build your style profile.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 14 }}>
              {liked.map((item) => (
                <div key={item.id}>
                  <ProductVisual imageUrl={item.imageUrl} color={item.color} height={180} radius={10} />
                  <div style={{ fontSize: 12.5, fontWeight: 500, marginTop: 7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</div>
                  <div style={{ fontSize: 11, color: "#8A8172", display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                    <span>{item.store}</span>
                    <span style={{ fontFamily: FONT_MONO }}>${item.price}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
              {[
                { id: "followers", label: `Followers (${followersList.length})` },
                { id: "following", label: `Following (${followingList.length})` },
              ].map((t) => (
                <button
                  key={t.id}
                  className="focus-ring"
                  onClick={() => setPeopleTab(t.id)}
                  style={{
                    padding: "6px 13px",
                    borderRadius: 999,
                    border: "1px solid " + (peopleTab === t.id ? "#211D18" : "#D8D0C0"),
                    background: peopleTab === t.id ? "#211D18" : "transparent",
                    color: peopleTab === t.id ? "#EDE7DD" : "#211D18",
                    fontSize: 12,
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {(peopleTab === "followers" ? followersList : followingList).length === 0 ? (
              <div style={{ border: "1.5px dashed #C9BFA9", borderRadius: 14, padding: "40px 24px", textAlign: "center", color: "#8A8172", fontSize: 13.5 }}>
                {peopleTab === "following" ? "You're not following anyone yet. Try Explore." : "No followers yet."}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(peopleTab === "followers" ? followersList : followingList).map((u) => (
                  <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 13, background: "#F7F3EA", border: "1px solid #E4DDCE", borderRadius: 10, padding: "12px 14px" }}>
                    <button className="focus-ring" onClick={() => setOpenProfile(u.id)} style={{ background: "none", border: "none", padding: 0, display: "flex" }}>
                      <Avatar color={u.avatar} name={u.name} size={42} />
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <button className="focus-ring" onClick={() => setOpenProfile(u.id)} style={{ background: "none", border: "none", padding: 0, textAlign: "left", fontSize: 13.5, fontWeight: 500, color: "#211D18" }}>
                        {u.name}
                      </button>
                      <div style={{ fontSize: 11.5, color: "#8A8172" }}>{u.handle}</div>
                    </div>
                    <button
                      className="focus-ring"
                      onClick={() => toggleFollow(u.id)}
                      style={{
                        background: u.followed ? "transparent" : "#211D18",
                        color: u.followed ? "#211D18" : "#EDE7DD",
                        border: u.followed ? "1px solid #D8D0C0" : "none",
                        borderRadius: 999,
                        padding: "7px 16px",
                        fontSize: 12,
                        flexShrink: 0,
                      }}
                    >
                      {u.followed ? "Following" : "Follow"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
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
      const storeCount = pins.filter((p) => p.store === item.store).length;
      if (storeCount > 0) { factors.push({ detail: `you already like ${item.store}`, weight: 0.7 }); total += 0.7; }
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

const TABS = [
  { id: "board", label: "Discover", icon: Compass },
  { id: "watch", label: "Watch", icon: Bell },
  { id: "trip", label: "Trip", icon: Plane },
  { id: "shelf", label: "Shelf", icon: Library },
];

export default function App() {
  const [tab, setTab] = useState("board");
  // Liked items ARE the style profile now — what used to be manually pinned
  // is now built up by swiping. Downstream screens (trip planner, trip detail)
  // read this as the taste signal.
  const [liked, setLiked] = useState(STARTER_PINS);
  const [watchlist, setWatchlist] = useState([]);
  const [tracked, setTracked] = useState(STARTER_TRACKED);
  const [openTrip, setOpenTrip] = useState(null);
  // People + profile navigation live here (not in ShelfScreen) because the
  // trip detail screen is a sibling and also needs to route to a profile.
  const [people, setPeople] = useState(PEOPLE);
  const [openProfile, setOpenProfile] = useState(null);
  const [toast, setToast] = useState(null);

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
              {t.id === "watch" && tracked.some((x) => x.droppedAt) && (
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#B85C38", display: "inline-block" }} />
              )}
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
        <DiscoverScreen liked={liked} setLiked={setLiked} watchlist={watchlist} onToggleWatch={handleToggleWatch} />
      ) : tab === "watch" ? (
        <WatchScreen tracked={tracked} setTracked={setTracked} />
      ) : tab === "trip" ? (
        <TripPlannerScreen pins={pins} />
      ) : (
        <ShelfScreen
          liked={liked}
          onOpenTrip={handleOpenTrip}
          people={people}
          onToggleFollow={handleToggleFollow}
          openProfile={openProfile}
          setOpenProfile={setOpenProfile}
        />
      )}

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
