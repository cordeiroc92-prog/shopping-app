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

const STARTER_LEGS = [
  { id: "rome1", city: "Rome", nights: 2, coastal: false, days: [
    { d: "Sep 28", hi: 26, lo: 17, icon: "sun" }, { d: "Sep 29", hi: 25, lo: 17, icon: "partly" }, { d: "Sep 30", hi: 24, lo: 16, icon: "sun" },
  ]},
  { id: "florence", city: "Florence", nights: 1, coastal: false, days: [
    { d: "Oct 1", hi: 22, lo: 13, icon: "partly" }, { d: "Oct 2", hi: 20, lo: 12, icon: "rain" },
  ]},
  { id: "sorrento", city: "Sorrento", nights: 4, coastal: true, days: [
    { d: "Oct 3", hi: 24, lo: 16, icon: "sun" }, { d: "Oct 4", hi: 24, lo: 16, icon: "sun" }, { d: "Oct 5", hi: 23, lo: 15, icon: "partly" }, { d: "Oct 6", hi: 22, lo: 15, icon: "cloud" }, { d: "Oct 7", hi: 23, lo: 15, icon: "sun" },
  ]},
  { id: "positano", city: "Positano", nights: 4, coastal: true, days: [
    { d: "Oct 8", hi: 23, lo: 16, icon: "sun" }, { d: "Oct 9", hi: 22, lo: 15, icon: "partly" }, { d: "Oct 10", hi: 21, lo: 14, icon: "rain" }, { d: "Oct 11", hi: 22, lo: 15, icon: "sun" },
  ]},
];

const STARTER_SUGGESTED = [
  { id: "s1", label: "Linen shirts", reason: "warm days across all legs", packed: true, category: "shirt", perDays: 2, qtyMin: 2, qtyMax: 8, scope: "all" },
  { id: "s2", label: "Light rain jacket", reason: "rain forecast in Florence, Positano", packed: false, category: "raincoat" },
  { id: "s3", label: "Layer for evenings", reason: "lows near 12–13°C in Florence", packed: false, category: "knitwear", perDays: 5, qtyMin: 1, qtyMax: 3, scope: "all" },
  { id: "s4", label: "Comfortable walking shoes", reason: "cobblestone cities, daily walking", packed: true, category: "footwear" },
  { id: "s5", label: "Sunglasses", reason: "sun most of trip", packed: true, category: "accessory" },
  { id: "s6", label: "Swimwear", reason: "Sorrento, Positano coastal legs", packed: false, category: "swimwear", perDays: 3, qtyMin: 1, qtyMax: 3, scope: "coastal" },
  { id: "s7", label: "Compact umbrella", reason: "rain forecast Oct 2, Oct 10", packed: false, category: null },
  { id: "s8", label: "Light scarf", reason: "cooler mornings, church visits", packed: false, category: "accessory" },
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
function ProductVisual({ imageUrl, color, height, radius = 6 }) {
  const [failed, setFailed] = useState(false);
  const showImage = imageUrl && imageUrl.trim() && !failed;
  if (showImage) {
    return (
      <img
        src={imageUrl}
        alt=""
        onError={() => setFailed(true)}
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
          <ProductVisual imageUrl={item.imageUrl} color={item.color} height={42} />
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

const DISCOVER_CATEGORIES = ["all", "dresses", "knitwear", "outerwear", "footwear", "denim", "tailoring", "accessory", "shirt", "swimwear"];

function DiscoverScreen({ liked, setLiked, watchlist, onToggleWatch }) {
  const [category, setCategory] = useState("all");
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState([]); // [{ id, action }] for undo
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [exiting, setExiting] = useState(null); // 'like' | 'pass'
  const startX = useRef(0);

  // The deck for the chosen category. In a real build this comes from the
  // product feed; for now it's the catalog we already have.
  const deck = useMemo(
    () => CATALOG.filter((c) => category === "all" || c.category === category),
    [category]
  );

  // Reset position when the category changes so each deck starts fresh.
  useEffect(() => {
    setIndex(0);
    setHistory([]);
    setDragX(0);
    setExiting(null);
  }, [category]);

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
                      <ProductVisual imageUrl={item.imageUrl} color={item.color} height={80} />
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
          <ProductVisual imageUrl={item.imageUrl} color={item.color} height="100%" radius={0} />
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
        <div style={{ fontFamily: FONT_MONO, fontSize: 14, flexShrink: 0 }}>
          {item.was && item.was > item.price && (
            <span style={{ textDecoration: "line-through", color: "#8A8172", fontSize: 11.5, marginRight: 5 }}>${item.was}</span>
          )}
          <span style={{ color: item.was && item.was > item.price ? "#B85C38" : "#211D18", fontWeight: 500 }}>${item.price}</span>
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
                    <ProductVisual imageUrl={item.imageUrl} color={item.color || "#8A8172"} height={52} />
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

/* ---------------------------------------------------
   SCREEN: TRIP PLANNER
--------------------------------------------------- */

function quantityFor(item, days) {
  if (!item.perDays) return null;
  const raw = Math.ceil(days / item.perDays);
  return Math.min(item.qtyMax, Math.max(item.qtyMin, raw));
}

function scopedDays(item, legs, tripDays) {
  if (!legs || legs.length === 0) return tripDays;
  const total = legs.reduce((s, l) => s + (l.nights || 0), 0);
  if (total === 0) return tripDays;
  if (item.scope === "coastal") {
    const coastal = legs.filter((l) => l.coastal).reduce((s, l) => s + (l.nights || 0), 0);
    return coastal > 0 ? coastal : total;
  }
  return total;
}

function shopMatchesFor(category, pins) {
  if (!category || pins.length === 0) return [];
  return CATALOG.filter((c) => c.category === category)
    .map((item) => ({ item, ...scoreAgainstBoard(item, pins, null) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 4);
}

function TripPlannerScreen({ pins }) {
  const [legs, setLegs] = useState(STARTER_LEGS);
  const [activeLeg, setActiveLeg] = useState(STARTER_LEGS[2].id);
  const [suggested, setSuggested] = useState(STARTER_SUGGESTED);
  const [other, setOther] = useState(STARTER_OTHER);
  const [newItem, setNewItem] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [shopItem, setShopItem] = useState(null);
  const [showItinerary, setShowItinerary] = useState(false);
  const [flatTripDays, setFlatTripDays] = useState(15);
  const [newLegName, setNewLegName] = useState("");

  const leg = legs.find((l) => l.id === activeLeg) || legs[0];
  const tripDays = legs.length > 0 ? legs.reduce((s, l) => s + (l.nights || 0), 0) : flatTripDays;

  const toggleSuggested = (id) => setSuggested((s) => s.map((i) => (i.id === id ? { ...i, packed: !i.packed } : i)));
  const toggleOther = (id) => setOther((s) => s.map((i) => (i.id === id ? { ...i, packed: !i.packed } : i)));

  const allItems = [...suggested, ...other];
  const packedCount = allItems.filter((i) => i.packed).length;
  const totalCount = allItems.length;

  const addOther = () => {
    if (!newItem.trim()) return;
    setOther((o) => [...o, { id: `custom-${Date.now()}`, label: newItem.trim(), packed: false, category: null }]);
    setNewItem("");
    setShowAdd(false);
  };

  const updateLegNights = (id, nights) => setLegs((ls) => ls.map((l) => (l.id === id ? { ...l, nights: Math.max(0, nights) } : l)));
  const toggleLegCoastal = (id) => setLegs((ls) => ls.map((l) => (l.id === id ? { ...l, coastal: !l.coastal } : l)));
  const removeLeg = (id) => {
    setLegs((ls) => ls.filter((l) => l.id !== id));
    if (activeLeg === id && legs.length > 1) {
      const next = legs.find((l) => l.id !== id);
      if (next) setActiveLeg(next.id);
    }
  };
  const addLeg = () => {
    if (!newLegName.trim()) return;
    const id = `leg-${Date.now()}`;
    setLegs((ls) => [...ls, { id, city: newLegName.trim(), nights: 2, coastal: false, days: [] }]);
    setNewLegName("");
  };

  const shopMatches = useMemo(() => (shopItem ? shopMatchesFor(shopItem.category, pins) : []), [shopItem, pins]);

  return (
    <div>
      <header style={{ padding: "28px 32px 20px", borderBottom: "1px solid #D8D0C0" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.14em", color: "#74856A", textTransform: "uppercase", marginBottom: 4 }}>
              <span>
                {tripDays} {tripDays === 1 ? "day" : "days"}
                {legs.length > 0 && ` across ${legs.length} ${legs.length === 1 ? "stop" : "stops"}`}
              </span>
              <button className="focus-ring" onClick={() => setShowItinerary(true)} style={{ background: "none", border: "1px solid #C9BFA9", borderRadius: 999, padding: "3px 10px", fontSize: 10.5, color: "#74856A", letterSpacing: "0.05em" }}>
                edit itinerary
              </button>
            </div>
            <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 500, fontSize: 34, margin: 0, letterSpacing: "-0.01em" }}>Italy, autumn</h1>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: FONT_MONO, fontSize: 22, fontWeight: 500 }}>{packedCount}<span style={{ color: "#8A8172" }}>/{totalCount}</span></div>
            <div style={{ fontSize: 11, color: "#8A8172" }}>packed</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 22, flexWrap: "wrap" }}>
          {legs.map((l) => (
            <button key={l.id} className="nav-tab focus-ring" onClick={() => setActiveLeg(l.id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 999, border: "1px solid " + (activeLeg === l.id ? "#211D18" : "#D8D0C0"), background: activeLeg === l.id ? "#211D18" : "transparent", color: activeLeg === l.id ? "#EDE7DD" : "#211D18", fontSize: 13 }}>
              <MapPin size={12} />
              {l.city}
            </button>
          ))}
        </div>
      </header>

      <div style={{ padding: "26px 32px 60px", maxWidth: 820 }}>
        {leg && (
          <section style={{ marginBottom: 32 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#74856A" }}>
                {leg.city} · {leg.nights} {leg.nights === 1 ? "night" : "nights"}
                {leg.coastal && " · coastal"}
              </span>
            </div>
            {leg.days.length > 0 ? (
              <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
                {leg.days.map((d) => (
                  <div key={d.d} style={{ background: "#F7F3EA", borderRadius: 10, padding: "14px 16px", minWidth: 88, flexShrink: 0, textAlign: "center", border: "1px solid #E4DDCE" }}>
                    <div style={{ fontSize: 11, color: "#8A8172", marginBottom: 8 }}>{d.d}</div>
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
                      <WeatherIcon icon={d.icon} size={20} color={d.icon === "rain" ? "#5B6B8C" : "#C79A44"} />
                    </div>
                    <div style={{ fontFamily: FONT_MONO, fontSize: 13.5, fontWeight: 500 }}>{d.hi}°</div>
                    <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: "#8A8172" }}>{d.lo}°</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: "#8A8172" }}>No forecast yet for this stop — added stops start without weather data.</div>
            )}
          </section>
        )}

        <section style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
            <CloudSun size={14} color="#B85C38" />
            <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#B85C38" }}>suggested for this trip</span>
          </div>
          <div style={{ background: "#F7F3EA", borderRadius: 12, overflow: "hidden", border: "1px solid #D8D0C0" }}>
            {suggested.map((item, idx) => (
              <div key={item.id} className="item-row" onClick={() => item.category && setShopItem(item)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px", borderBottom: idx < suggested.length - 1 ? "1px solid #E4DDCE" : "none", cursor: item.category ? "pointer" : "default" }}>
                <div className="checkbox focus-ring" role="checkbox" tabIndex={0} aria-checked={item.packed} aria-label={`Mark ${item.label} as ${item.packed ? "not packed" : "packed"}`} onClick={(e) => { e.stopPropagation(); toggleSuggested(item.id); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); toggleSuggested(item.id); } }} style={{ width: 20, height: 20, borderRadius: 6, border: "1.5px solid " + (item.packed ? "#74856A" : "#C9BFA9"), background: item.packed ? "#74856A" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {item.packed && <Check size={13} color="#F7F3EA" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {(() => {
                    const days = scopedDays(item, legs, tripDays);
                    const qty = quantityFor(item, days);
                    const isCoastalScoped = item.scope === "coastal" && legs.some((l) => l.coastal);
                    return (
                      <>
                        <div style={{ fontSize: 13.5, fontWeight: 500, opacity: item.packed ? 0.55 : 1, textDecoration: item.packed ? "line-through" : "none" }}>
                          {item.label}
                          {qty !== null && <span style={{ fontFamily: FONT_MONO, color: "#8A8172", fontWeight: 400, marginLeft: 6 }}>×{qty}</span>}
                        </div>
                        <div style={{ fontSize: 11.5, color: "#8A8172", marginTop: 2 }}>
                          {item.reason}
                          {qty !== null && (isCoastalScoped ? ` · scaled for ${days} coastal ${days === 1 ? "night" : "nights"}` : ` · scaled for ${days} ${days === 1 ? "day" : "days"}`)}
                        </div>
                      </>
                    );
                  })()}
                </div>
                {item.category && <ShoppingBag size={15} color="#8A8172" style={{ flexShrink: 0 }} />}
              </div>
            ))}
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
              <div key={item.id} className="item-row" onClick={() => item.category && setShopItem(item)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px", borderBottom: idx < other.length - 1 ? "1px solid #E4DDCE" : "none", cursor: item.category ? "pointer" : "default" }}>
                <div className="checkbox focus-ring" role="checkbox" tabIndex={0} aria-checked={item.packed} aria-label={`Mark ${item.label} as ${item.packed ? "not packed" : "packed"}`} onClick={(e) => { e.stopPropagation(); toggleOther(item.id); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); toggleOther(item.id); } }} style={{ width: 20, height: 20, borderRadius: 6, border: "1.5px solid " + (item.packed ? "#74856A" : "#C9BFA9"), background: item.packed ? "#74856A" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {item.packed && <Check size={13} color="#F7F3EA" />}
                </div>
                <div style={{ flex: 1, fontSize: 13.5, fontWeight: 500, opacity: item.packed ? 0.55 : 1, textDecoration: item.packed ? "line-through" : "none" }}>{item.label}</div>
                {item.category && <ShoppingBag size={15} color="#8A8172" style={{ flexShrink: 0 }} />}
              </div>
            ))}
            {other.length === 0 && <div style={{ padding: "20px 16px", textAlign: "center", fontSize: 13, color: "#8A8172" }}>Nothing here yet.</div>}
          </div>
        </section>
      </div>

      {showItinerary && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(33,29,24,0.42)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }} onClick={() => setShowItinerary(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#F7F3EA", borderRadius: 14, padding: 24, width: 420, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 30px 60px -20px rgba(33,29,24,0.4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 500, margin: 0 }}>Itinerary</h2>
              <button className="focus-ring" onClick={() => setShowItinerary(false)} style={{ background: "none", border: "none" }}><X size={18} /></button>
            </div>
            <p style={{ fontSize: 12, color: "#8A8172", margin: "0 0 18px", lineHeight: 1.5 }}>
              Add each stop and how many nights you'll spend there. Mark coastal stops so swimwear only scales against beach time, not the whole trip. Skip this and packing quantities fall back to total trip length.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
              {legs.map((l) => (
                <div key={l.id} style={{ background: "#fff", border: "1px solid #E4DDCE", borderRadius: 10, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500 }}>{l.city}</div>
                    <button className="focus-ring" onClick={() => toggleLegCoastal(l.id)} style={{ marginTop: 4, background: l.coastal ? "#74856A" : "transparent", color: l.coastal ? "#F7F3EA" : "#8A8172", border: "1px solid " + (l.coastal ? "#74856A" : "#D8D0C0"), borderRadius: 999, padding: "2px 9px", fontSize: 10, fontFamily: FONT_MONO }}>
                      {l.coastal ? "coastal" : "mark as coastal"}
                    </button>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                    <button aria-label={`Decrease nights in ${l.city}`} className="focus-ring" onClick={() => updateLegNights(l.id, l.nights - 1)} style={{ width: 22, height: 22, borderRadius: "50%", border: "1px solid #C9BFA9", background: "transparent", color: "#74856A", fontSize: 13, lineHeight: 1, padding: 0 }}>−</button>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 13, minWidth: 42, textAlign: "center" }}>{l.nights} {l.nights === 1 ? "night" : "nights"}</span>
                    <button aria-label={`Increase nights in ${l.city}`} className="focus-ring" onClick={() => updateLegNights(l.id, l.nights + 1)} style={{ width: 22, height: 22, borderRadius: "50%", border: "1px solid #C9BFA9", background: "transparent", color: "#74856A", fontSize: 13, lineHeight: 1, padding: 0 }}>+</button>
                  </div>
                  <button aria-label={`Remove ${l.city} from itinerary`} className="focus-ring" onClick={() => removeLeg(l.id)} style={{ background: "none", border: "none", color: "#B85C38", flexShrink: 0, padding: 4 }}><X size={14} /></button>
                </div>
              ))}
              {legs.length === 0 && <div style={{ fontSize: 12.5, color: "#8A8172", padding: "8px 2px" }}>No stops added — packing quantities will use total trip length instead.</div>}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input className="focus-ring" value={newLegName} onChange={(e) => setNewLegName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addLeg()} placeholder="Add a stop, e.g. Venice" style={{ flex: 1, padding: "9px 11px", borderRadius: 8, border: "1px solid #D8D0C0", fontSize: 13.5, background: "#fff" }} />
              <button className="focus-ring" onClick={addLeg} style={{ display: "flex", alignItems: "center", gap: 5, background: "#211D18", color: "#EDE7DD", border: "none", borderRadius: 8, padding: "9px 14px", fontSize: 13 }}>
                <Plus size={13} /> add
              </button>
            </div>
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px dashed #D8D0C0", fontSize: 11.5, color: "#8A8172" }}>Total: {tripDays} {tripDays === 1 ? "day" : "days"}</div>
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
              <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "#B85C38" }}>matched to your mood board</span>
            </div>
            <p style={{ fontSize: 11.5, color: "#8A8172", margin: "4px 0 16px", lineHeight: 1.5 }}>Ranked using the colours, price range, and stores from what you've pinned.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {shopMatches.map(({ item, factors }, i) => <MatchCard key={item.id} item={item} factors={factors} index={i} />)}
              {shopMatches.length === 0 && (
                <div style={{ fontSize: 12.5, color: "#8A8172" }}>
                  {pins.length === 0 ? "Pin a few things on the board first, so matches can be ranked to your style." : "Nothing matching this yet — check back once a few more pieces are on your board."}
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

      {/* Tab bar */}
      <nav style={{ display: "flex", gap: 4, padding: "14px 32px 0", borderBottom: "1px solid #D8D0C0", background: "#EDE7DD", position: "sticky", top: 0, zIndex: 20 }}>
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
