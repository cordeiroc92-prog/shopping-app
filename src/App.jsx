import React, { useState, useMemo, useCallback } from "react";
import {
  Plus, X, Pin as PinIcon, Sparkles, Tag, ExternalLink, Trash2,
  Bell, TrendingDown, Store, ChevronDown, Check, BellOff,
  Cloud, CloudRain, Sun, CloudSun, MapPin, Luggage, ChevronRight, ShoppingBag,
  Heart, Search, ArrowLeft, HelpCircle, LayoutGrid, Plane, Library, Upload, AlertCircle,
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
   SCREEN: MOOD BOARD
--------------------------------------------------- */

function MoodBoardScreen({ pins, setPins, onTrackPrice }) {
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ title: "", store: "", price: "", tag: "knitwear", color: SWATCHES[0].hue, imageUrl: "", sourceUrl: "" });
  const [activePin, setActivePin] = useState(null);

  const addPin = useCallback(() => {
    if (!draft.title.trim() || !draft.store.trim()) return;
    const id = Date.now();
    setPins((p) => [...p, { id, title: draft.title.trim(), store: draft.store.trim(), price: Number(draft.price) || 0, color: draft.color, tag: draft.tag, imageUrl: proxied(draft.imageUrl), sourceUrl: draft.sourceUrl.trim(), h: 220 + Math.round(Math.random() * 100), tilt: (Math.random() - 0.5) * 5 }]);
    setDraft({ title: "", store: "", price: "", tag: "knitwear", color: SWATCHES[0].hue, imageUrl: "", sourceUrl: "" });
    setShowAdd(false);
  }, [draft, setPins]);

  const removePin = useCallback((id) => setPins((p) => p.filter((x) => x.id !== id)), [setPins]);

  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState(null); // { rows, warnings } once parsed

  const KNOWN_CATEGORIES = ["knitwear", "outerwear", "footwear", "denim", "tailoring", "accessory", "raincoat", "swimwear", "shirt", "dresses"];

  // Parses pasted tab-separated data (copied directly out of Excel, Numbers,
  // or Google Sheets — this is the most reliable cross-format path, since it
  // sidesteps every proprietary file format entirely). Expected column order
  // matches the product upload tracker: Title, Store, Price, Category,
  // Colour, Image URL, Product page URL, Notes. Header row is optional and
  // auto-detected/skipped if the first cell reads "title".
  const parseImport = useCallback(() => {
    const lines = importText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      setImportPreview({ rows: [], warnings: ["Nothing pasted yet."] });
      return;
    }
    let dataLines = lines;
    if (lines[0].toLowerCase().startsWith("title")) dataLines = lines.slice(1);

    const rows = [];
    const warnings = [];
    dataLines.forEach((line, i) => {
      const cells = line.split("\t");
      const [title, store, price, category, colourRaw, imageUrl, sourceUrl] = cells;
      const rowNum = i + 1;
      if (!title || !store) {
        warnings.push(`Row ${rowNum}: missing title or store — skipped.`);
        return;
      }
      const priceNum = Number(String(price || "0").replace(/[^0-9.]/g, ""));
      if (!priceNum) warnings.push(`Row ${rowNum} ("${title}"): no valid price, set to $0.`);
      const cat = (category || "").trim().toLowerCase();
      if (cat && !KNOWN_CATEGORIES.includes(cat)) {
        warnings.push(`Row ${rowNum} ("${title}"): category "${category}" isn't recognized — kept as-is, but it won't match the dropdown until added.`);
      }
      const colour = resolveColour((colourRaw || "").trim());
      if ((colourRaw || "").trim() && colour === "#8A8172" && !SWATCHES.some((s) => s.name === colourRaw.trim().toLowerCase())) {
        warnings.push(`Row ${rowNum} ("${title}"): colour "${colourRaw}" not recognized — used a neutral grey swatch.`);
      }
      rows.push({
        title: title.trim(),
        store: store.trim(),
        price: priceNum,
        tag: cat || "accessory",
        color: colour,
        imageUrl: proxied(imageUrl || ""),
        sourceUrl: (sourceUrl || "").trim(),
      });
    });
    setImportPreview({ rows, warnings });
  }, [importText]);

  const confirmImport = useCallback(() => {
    if (!importPreview || importPreview.rows.length === 0) return;
    const newPins = importPreview.rows.map((r, i) => ({
      id: Date.now() + i,
      ...r,
      h: 220 + Math.round(Math.random() * 100),
      tilt: (Math.random() - 0.5) * 5,
    }));
    setPins((p) => [...p, ...newPins]);
    setImportText("");
    setImportPreview(null);
    setShowImport(false);
  }, [importPreview, setPins]);

  const recommendations = useMemo(() => {
    if (pins.length === 0) return [];
    const scored = CATALOG.map((item) => {
      let best = { total: -1, factors: [], pin: null };
      for (const pin of pins) {
        const s = scoreAgainstBoard(item, pins, pin);
        if (s.total > best.total) best = { ...s, pin };
      }
      return { item, ...best };
    });
    return scored.sort((a, b) => b.total - a.total).slice(0, 4);
  }, [pins]);

  const pinRecommendations = useMemo(() => {
    if (!activePin || pins.length === 0) return [];
    return CATALOG.filter((item) => !(item.store === activePin.store && item.title === activePin.title))
      .map((item) => ({ item, ...scoreAgainstBoard(item, pins, activePin) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);
  }, [activePin, pins]);

  return (
    <div>
      <header style={{ padding: "28px 32px 20px", borderBottom: "1px solid #D8D0C0", display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.14em", color: "#74856A", textTransform: "uppercase", marginBottom: 4 }}>
            board · {pins.length} pinned
          </div>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 500, fontSize: 34, margin: 0, letterSpacing: "-0.01em" }}>The corkboard</h1>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="focus-ring" onClick={() => setShowImport(true)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", color: "#211D18", border: "1px solid #D8D0C0", borderRadius: 999, padding: "11px 20px", fontSize: 14, fontWeight: 500 }}>
            <Upload size={16} /> Import
          </button>
          <button className="focus-ring" onClick={() => setShowAdd(true)} style={{ display: "flex", alignItems: "center", gap: 8, background: "#211D18", color: "#EDE7DD", border: "none", borderRadius: 999, padding: "11px 20px", fontSize: 14, fontWeight: 500 }}>
            <Plus size={16} /> Pin something
          </button>
        </div>
      </header>

      <div style={{ display: "flex", gap: 0, alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 auto", padding: "28px 20px 60px 32px", columnCount: 3, columnGap: 20 }}>
          {pins.length === 0 && (
            <div style={{ border: "1.5px dashed #C9BFA9", borderRadius: 14, padding: "48px 24px", textAlign: "center", color: "#8A8172", fontSize: 14 }}>
              Nothing's pinned yet. Add a piece you like and the board will start suggesting what goes with it.
            </div>
          )}
          {pins.map((pin) => (
            <div key={pin.id} className="pin-card" onClick={() => setActivePin(pin)} style={{ breakInside: "avoid", marginBottom: 20, background: "#F7F3EA", borderRadius: 10, padding: 10, boxShadow: "0 6px 14px -8px rgba(33,29,24,0.22)", transform: `rotate(${pin.tilt}deg)`, position: "relative", cursor: "pointer" }}>
              <PinIcon size={16} style={{ position: "absolute", top: -8, left: "50%", transform: "translateX(-50%) rotate(-15deg)", color: "#C79A44", fill: "#C79A44" }} />
              <div style={{ marginBottom: 10 }}>
                <ProductVisual imageUrl={pin.imageUrl} color={pin.color} height={pin.h} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.3 }}>{pin.title}</div>
                  <div style={{ fontSize: 11.5, color: "#8A8172", marginTop: 2 }}>{pin.store}</div>
                </div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 12.5, whiteSpace: "nowrap", paddingTop: 1 }}>${pin.price}</div>
              </div>
              <button aria-label={`Remove ${pin.title} from board`} onClick={(e) => { e.stopPropagation(); removePin(pin.id); }} className="focus-ring pin-remove" style={{ position: "absolute", top: 6, right: 6, background: "rgba(237,231,221,0.9)", border: "none", borderRadius: "50%", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <X size={13} color="#211D18" />
              </button>
            </div>
          ))}
        </div>

        <aside className="mb-scroll" style={{ width: 300, flexShrink: 0, borderLeft: "1px solid #D8D0C0", padding: "28px 22px 40px", position: "sticky", top: 0, maxHeight: "100vh", overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
            <Sparkles size={14} color="#B85C38" />
            <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#B85C38" }}>pulled from your board</span>
          </div>
          <p style={{ fontSize: 12.5, color: "#8A8172", marginTop: 4, marginBottom: 22, lineHeight: 1.5 }}>Matched by category and colour to what's already pinned.</p>
          {recommendations.length === 0 && <div style={{ fontSize: 13, color: "#8A8172" }}>Pin a few things to see matches.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {recommendations.map(({ item, pin, factors }) => {
              const onSale = item.was > item.price;
              const topFactor = factors[0];
              return (
                <div key={item.id} className="rec-card" style={{ background: "#F7F3EA", borderRadius: 10, padding: 12, boxShadow: "0 4px 10px -6px rgba(33,29,24,0.18)" }}>
                  <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ width: 48, height: 48, flexShrink: 0 }}>
                      <ProductVisual imageUrl={item.imageUrl} color={item.color} height={48} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}>{item.title}</div>
                      <div style={{ fontSize: 11, color: "#8A8172", marginTop: 2 }}>{item.store}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                    <div style={{ fontFamily: FONT_MONO, fontSize: 12.5 }}>
                      {onSale && <span style={{ textDecoration: "line-through", color: "#8A8172", marginRight: 6 }}>${item.was}</span>}
                      <span style={{ color: onSale ? "#B85C38" : "#211D18", fontWeight: 500 }}>${item.price}</span>
                    </div>
                    {onSale && <span style={{ fontSize: 10, fontFamily: FONT_MONO, background: "#B85C38", color: "#F7F3EA", padding: "2px 7px", borderRadius: 999 }}>−{Math.round((1 - item.price / item.was) * 100)}%</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 9, paddingTop: 9, borderTop: "1px dashed #D8D0C0", fontSize: 10.5, color: "#74856A" }}>
                    <Tag size={10} />
                    {topFactor ? topFactor.detail : `goes with "${pin.title}"`}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>

      {showAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(33,29,24,0.42)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }} onClick={() => setShowAdd(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#F7F3EA", borderRadius: 14, padding: 26, width: 380, maxWidth: "100%", boxShadow: "0 30px 60px -20px rgba(33,29,24,0.4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 500, margin: 0 }}>Pin an item</h2>
              <button className="focus-ring" onClick={() => setShowAdd(false)} style={{ background: "none", border: "none" }}><X size={18} /></button>
            </div>
            <label style={{ fontSize: 12, color: "#8A8172", display: "block", marginBottom: 5 }}>What is it</label>
            <input className="focus-ring" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="e.g. Camel wool coat" style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid #D8D0C0", marginBottom: 14, fontSize: 13.5, background: "#fff" }} />
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: "#8A8172", display: "block", marginBottom: 5 }}>Store</label>
                <input className="focus-ring" value={draft.store} onChange={(e) => setDraft((d) => ({ ...d, store: e.target.value }))} placeholder="e.g. COS" style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid #D8D0C0", fontSize: 13.5, background: "#fff" }} />
              </div>
              <div style={{ width: 90 }}>
                <label style={{ fontSize: 12, color: "#8A8172", display: "block", marginBottom: 5 }}>Price</label>
                <input className="focus-ring" type="number" value={draft.price} onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))} placeholder="0" style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid #D8D0C0", fontSize: 13.5, background: "#fff" }} />
              </div>
            </div>
            <label style={{ fontSize: 12, color: "#8A8172", display: "block", marginBottom: 5 }}>Category</label>
            <select className="focus-ring" value={draft.tag} onChange={(e) => setDraft((d) => ({ ...d, tag: e.target.value }))} style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid #D8D0C0", marginBottom: 14, fontSize: 13.5, background: "#fff" }}>
              {["knitwear", "outerwear", "footwear", "denim", "tailoring", "accessory", "raincoat", "swimwear", "shirt", "dresses"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>

            <label style={{ fontSize: 12, color: "#8A8172", display: "block", marginBottom: 5 }}>Product page link (optional)</label>
            <input className="focus-ring" value={draft.sourceUrl} onChange={(e) => setDraft((d) => ({ ...d, sourceUrl: e.target.value }))} placeholder="https://..." style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid #D8D0C0", marginBottom: 14, fontSize: 13.5, background: "#fff" }} />

            <label style={{ fontSize: 12, color: "#8A8172", display: "block", marginBottom: 5 }}>Image link (optional — falls back to a colour swatch)</label>
            <input className="focus-ring" value={draft.imageUrl} onChange={(e) => setDraft((d) => ({ ...d, imageUrl: e.target.value }))} placeholder="https://... (right-click a product photo, copy image address)" style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid #D8D0C0", marginBottom: 14, fontSize: 13.5, background: "#fff" }} />

            <label style={{ fontSize: 12, color: "#8A8172", display: "block", marginBottom: 7 }}>Colour {draft.imageUrl.trim() && "(used if the image link doesn't load)"}</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 22, flexWrap: "wrap" }}>
              {SWATCHES.map((s) => (
                <button key={s.hue} aria-label={s.name} className="focus-ring" onClick={() => setDraft((d) => ({ ...d, color: s.hue }))} style={{ width: 28, height: 28, borderRadius: "50%", background: s.hue, border: draft.color === s.hue ? "2.5px solid #211D18" : "2.5px solid transparent", boxShadow: "0 0 0 1px rgba(0,0,0,0.06)" }} />
              ))}
            </div>
            <button className="focus-ring" onClick={addPin} style={{ width: "100%", background: "#211D18", color: "#EDE7DD", border: "none", borderRadius: 999, padding: "12px 0", fontSize: 14, fontWeight: 500 }}>Add to board</button>
          </div>
        </div>
      )}

      {showImport && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(33,29,24,0.42)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }} onClick={() => { setShowImport(false); setImportPreview(null); }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#F7F3EA", borderRadius: 14, padding: 26, width: 520, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 30px 60px -20px rgba(33,29,24,0.4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 500, margin: 0 }}>Import products</h2>
              <button className="focus-ring" onClick={() => { setShowImport(false); setImportPreview(null); }} style={{ background: "none", border: "none" }}><X size={18} /></button>
            </div>
            <p style={{ fontSize: 12, color: "#8A8172", margin: "0 0 16px", lineHeight: 1.5 }}>
              Select your rows in the spreadsheet (Title, Store, Price, Category, Colour, Image URL, Product page URL), copy, and paste below. The header row is fine to include.
            </p>

            {!importPreview && (
              <>
                <textarea
                  className="focus-ring"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="Paste tab-separated rows here..."
                  rows={8}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #D8D0C0", fontSize: 12.5, fontFamily: FONT_MONO, background: "#fff", marginBottom: 14, resize: "vertical" }}
                />
                <button className="focus-ring" onClick={parseImport} style={{ width: "100%", background: "#211D18", color: "#EDE7DD", border: "none", borderRadius: 999, padding: "12px 0", fontSize: 14, fontWeight: 500 }}>
                  Preview import
                </button>
              </>
            )}

            {importPreview && (
              <>
                {importPreview.warnings.length > 0 && (
                  <div style={{ background: "#FFF3C4", border: "1px solid #E8D28A", borderRadius: 10, padding: 12, marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, fontSize: 11.5, fontWeight: 500, color: "#6B5A1E" }}>
                      <AlertCircle size={13} /> {importPreview.warnings.length} thing{importPreview.warnings.length > 1 ? "s" : ""} to check
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {importPreview.warnings.map((w, i) => (
                        <div key={i} style={{ fontSize: 11, color: "#6B5A1E", lineHeight: 1.4 }}>{w}</div>
                      ))}
                    </div>
                  </div>
                )}

                {importPreview.rows.length > 0 ? (
                  <>
                    <div style={{ fontSize: 12, color: "#8A8172", marginBottom: 10 }}>
                      {importPreview.rows.length} product{importPreview.rows.length > 1 ? "s" : ""} ready to add:
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16, maxHeight: 260, overflowY: "auto" }}>
                      {importPreview.rows.map((r, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #E4DDCE", borderRadius: 8, padding: 8 }}>
                          <div style={{ width: 32, height: 32, flexShrink: 0 }}>
                            <ProductVisual imageUrl={r.imageUrl} color={r.color} height={32} radius={5} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 500 }}>{r.title}</div>
                            <div style={{ fontSize: 10.5, color: "#8A8172" }}>{r.store} · {r.tag} · ${r.price}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="focus-ring" onClick={() => setImportPreview(null)} style={{ flex: 1, background: "none", border: "1px solid #D8D0C0", borderRadius: 999, padding: "11px 0", fontSize: 13.5 }}>
                        Back
                      </button>
                      <button className="focus-ring" onClick={confirmImport} style={{ flex: 2, background: "#211D18", color: "#EDE7DD", border: "none", borderRadius: 999, padding: "11px 0", fontSize: 13.5, fontWeight: 500 }}>
                        Add {importPreview.rows.length} to board
                      </button>
                    </div>
                  </>
                ) : (
                  <button className="focus-ring" onClick={() => setImportPreview(null)} style={{ width: "100%", background: "none", border: "1px solid #D8D0C0", borderRadius: 999, padding: "11px 0", fontSize: 13.5 }}>
                    Back
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {activePin && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(33,29,24,0.42)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }} onClick={() => setActivePin(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#F7F3EA", borderRadius: 14, padding: 24, width: 400, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 30px 60px -20px rgba(33,29,24,0.4)" }}>
            <div style={{ marginBottom: 16 }}>
              <ProductVisual imageUrl={activePin.imageUrl} color={activePin.color} height={160} radius={8} />
            </div>
            <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 19, margin: "0 0 4px" }}>{activePin.title}</h3>
            <div style={{ fontSize: 13, color: "#8A8172", marginBottom: 14 }}>{activePin.store}</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: 16 }}>${activePin.price}</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="focus-ring" onClick={() => { removePin(activePin.id); setActivePin(null); }} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px solid #D8D0C0", borderRadius: 999, padding: "8px 14px", fontSize: 12.5, color: "#B85C38" }}>
                  <Trash2 size={13} /> Unpin
                </button>
                <button className="focus-ring" onClick={() => { onTrackPrice(activePin); setActivePin(null); }} style={{ display: "flex", alignItems: "center", gap: 6, background: "#211D18", color: "#EDE7DD", border: "none", borderRadius: 999, padding: "8px 14px", fontSize: 12.5 }}>
                  <Bell size={12} /> Track price
                </button>
              </div>
            </div>
            {activePin.sourceUrl && (
              <a href={activePin.sourceUrl} target="_blank" rel="noopener noreferrer" className="focus-ring" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 12, color: "#74856A", textDecoration: "none" }}>
                <ExternalLink size={12} /> view the real product page
              </a>
            )}
            <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px dashed #D8D0C0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                <Sparkles size={13} color="#B85C38" />
                <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "#B85C38" }}>because of this pin, and your board</span>
              </div>
              <p style={{ fontSize: 11.5, color: "#8A8172", margin: "4px 0 14px", lineHeight: 1.5 }}>Ranked by category fit, colour, typical spend, and store variety.</p>
              {pinRecommendations.length === 0 && <div style={{ fontSize: 12.5, color: "#8A8172" }}>Pin a couple more things to unlock matches.</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {pinRecommendations.map(({ item, factors }, i) => <MatchCard key={item.id} item={item} factors={factors} index={i} />)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------
   SCREEN: PRICE WATCH
--------------------------------------------------- */

function sparkPath(history, w, h) {
  const max = Math.max(...history);
  const min = Math.min(...history);
  const range = max - min || 1;
  const step = w / (history.length - 1);
  return history
    .map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function PriceTrackerScreen({ tracked }) {
  const [storeFilter, setStoreFilter] = useState("All stores");
  const [dismissed, setDismissed] = useState([]);
  const [muted, setMuted] = useState([]);
  const [storeMenuOpen, setStoreMenuOpen] = useState(false);

  const stores = useMemo(() => ["All stores", ...Array.from(new Set(tracked.map((t) => t.store)))], [tracked]);

  const alerts = useMemo(
    () => tracked.filter((i) => i.droppedAt && !dismissed.includes(i.id) && !muted.includes(i.id)),
    [tracked, dismissed, muted]
  );
  const visibleItems = useMemo(
    () => tracked.filter((i) => storeFilter === "All stores" || i.store === storeFilter),
    [tracked, storeFilter]
  );

  const dismissAlert = (id) => setDismissed((d) => [...d, id]);
  const toggleMute = (id) => setMuted((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));

  return (
    <div>
      <header style={{ padding: "28px 32px 20px", borderBottom: "1px solid #D8D0C0", display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.14em", color: "#74856A", textTransform: "uppercase", marginBottom: 4 }}>
            {tracked.length} items on watch
          </div>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 500, fontSize: 34, margin: 0, letterSpacing: "-0.01em" }}>Price watch</h1>
        </div>
        <div style={{ position: "relative" }}>
          <button className="focus-ring" onClick={() => setStoreMenuOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 8, background: "#F7F3EA", border: "1px solid #D8D0C0", borderRadius: 999, padding: "10px 16px", fontSize: 13.5 }}>
            <Store size={14} />
            {storeFilter}
            <ChevronDown size={14} style={{ transform: storeMenuOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
          </button>
          {storeMenuOpen && (
            <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", background: "#F7F3EA", border: "1px solid #D8D0C0", borderRadius: 10, boxShadow: "0 12px 24px -10px rgba(33,29,24,0.25)", overflow: "hidden", zIndex: 10, minWidth: 160 }}>
              {stores.map((s) => (
                <button key={s} className="focus-ring" onClick={() => { setStoreFilter(s); setStoreMenuOpen(false); }} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "9px 14px", background: s === storeFilter ? "#EDE7DD" : "transparent", border: "none", fontSize: 13, textAlign: "left" }}>
                  {s}
                  {s === storeFilter && <Check size={13} color="#74856A" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <div style={{ padding: "26px 32px 60px", maxWidth: 780 }}>
        <section style={{ marginBottom: 36 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
            <Bell size={14} color="#B85C38" />
            <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#B85C38" }}>price drops</span>
          </div>

          {alerts.length === 0 ? (
            <div style={{ border: "1.5px dashed #C9BFA9", borderRadius: 14, padding: "28px 24px", textAlign: "center", color: "#8A8172", fontSize: 13.5 }}>
              No new drops. Everything you're watching is holding steady.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {alerts.map((item) => {
                const current = item.history[item.history.length - 1];
                const prev = item.history[item.history.length - 2];
                const pct = Math.round((1 - current / prev) * 100);
                const belowThreshold = current <= item.threshold;
                return (
                  <div key={item.id} className="alert-card" style={{ background: "#F7F3EA", borderRadius: 10, borderLeft: "3px solid #B85C38", padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, boxShadow: "0 6px 14px -10px rgba(33,29,24,0.2)" }}>
                    <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#B85C38", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <TrendingDown size={16} color="#F7F3EA" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{item.title}</div>
                      <div style={{ fontSize: 12, color: "#8A8172", marginTop: 2 }}>
                        {item.store} · dropped {item.droppedAt}
                        {belowThreshold && <span style={{ color: "#74856A", fontWeight: 500 }}> · under your ${item.threshold} target</span>}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontFamily: FONT_MONO, fontSize: 15, fontWeight: 500 }}>
                        ${current}
                        <span style={{ fontSize: 11, color: "#B85C38", marginLeft: 6 }}>−{pct}%</span>
                      </div>
                      <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: "#8A8172", textDecoration: "line-through" }}>${prev}</div>
                    </div>
                    <button aria-label={`Dismiss alert for ${item.title}`} className="focus-ring" onClick={() => dismissAlert(item.id)} style={{ background: "none", border: "none", color: "#8A8172", flexShrink: 0, padding: 4 }}>
                      <X size={15} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
            <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#74856A" }}>everything you're watching</span>
          </div>

          <div style={{ background: "#F7F3EA", borderRadius: 12, overflow: "hidden", border: "1px solid #D8D0C0" }}>
            {visibleItems.map((item, idx) => {
              const current = item.history[item.history.length - 1];
              const isMuted = muted.includes(item.id);
              const w = 90;
              const h = 28;
              return (
                <div key={item.id} className="tracked-row" style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px", borderBottom: idx < visibleItems.length - 1 ? "1px solid #E4DDCE" : "none" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, opacity: isMuted ? 0.5 : 1 }}>{item.title}</div>
                    <div style={{ fontSize: 11.5, color: "#8A8172", marginTop: 2 }}>{item.store}</div>
                  </div>
                  <svg width={w} height={h} style={{ flexShrink: 0, opacity: isMuted ? 0.4 : 1 }}>
                    <path d={sparkPath(item.history, w, h)} fill="none" stroke={item.droppedAt ? "#B85C38" : "#B9B2A0"} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 13.5, width: 54, textAlign: "right", flexShrink: 0, opacity: isMuted ? 0.5 : 1 }}>${current}</div>
                  <div style={{ fontSize: 10.5, color: "#8A8172", width: 88, flexShrink: 0 }}>target ${item.threshold}</div>
                  <button aria-label={isMuted ? `Unmute alerts for ${item.title}` : `Mute alerts for ${item.title}`} className="focus-ring" onClick={() => toggleMute(item.id)} style={{ background: "none", border: "none", color: isMuted ? "#8A8172" : "#211D18", flexShrink: 0, padding: 4 }}>
                    {isMuted ? <BellOff size={14} /> : <Bell size={14} />}
                  </button>
                  <button aria-label={`View ${item.title} at ${item.store}`} className="focus-ring" style={{ background: "none", border: "none", color: "#74856A", flexShrink: 0, padding: 4 }}>
                    <ExternalLink size={14} />
                  </button>
                </div>
              );
            })}
            {visibleItems.length === 0 && (
              <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 13, color: "#8A8172" }}>
                {tracked.length === 0 ? "Nothing tracked yet. Pin something on the board and choose \"track price.\"" : `Nothing tracked from ${storeFilter} yet.`}
              </div>
            )}
          </div>
        </section>
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
   SCREEN: THE SHELF (library) + trip detail
--------------------------------------------------- */

function initials(name) {
  return name.split(" ").map((p) => p[0]).join("").toUpperCase();
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

function TripLibraryScreen({ pins, onOpenTrip }) {
  const [likedIds, setLikedIds] = useState([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("popular");

  const toggleLike = (id) => setLikedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const filtered = useMemo(() => {
    let list = TRIPS_LIBRARY.filter((t) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return t.title.toLowerCase().includes(q) || t.author.toLowerCase().includes(q) || t.cities.some((c) => c.toLowerCase().includes(q));
    });
    if (sort === "popular") list = [...list].sort((a, b) => b.likes - a.likes);
    if (sort === "longest") list = [...list].sort((a, b) => parseInt(b.duration) - parseInt(a.duration));
    return list;
  }, [query, sort]);

  return (
    <div>
      <header style={{ padding: "28px 32px 20px", borderBottom: "1px solid #D8D0C0" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.14em", color: "#74856A", textTransform: "uppercase", marginBottom: 4 }}>{TRIPS_LIBRARY.length} luggages shared</div>
            <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 500, fontSize: 34, margin: 0, letterSpacing: "-0.01em" }}>The shelf</h1>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: "1 1 220px" }}>
            <Search size={14} color="#8A8172" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
            <input className="focus-ring" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by place, trip, or traveller" style={{ width: "100%", padding: "9px 12px 9px 34px", borderRadius: 999, border: "1px solid #D8D0C0", fontSize: 13.5, background: "#F7F3EA" }} />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {[{ id: "popular", label: "Popular" }, { id: "longest", label: "Longest" }].map((s) => (
              <button key={s.id} className="focus-ring" onClick={() => setSort(s.id)} style={{ padding: "9px 14px", borderRadius: 999, border: "1px solid " + (sort === s.id ? "#211D18" : "#D8D0C0"), background: sort === s.id ? "#211D18" : "transparent", color: sort === s.id ? "#EDE7DD" : "#211D18", fontSize: 12.5 }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div style={{ padding: "28px 32px 60px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 20 }}>
        {filtered.map((trip) => {
          const liked = likedIds.includes(trip.id);
          return (
            <div key={trip.id} className="trip-card" onClick={() => onOpenTrip(trip)} style={{ background: "#F7F3EA", borderRadius: 12, overflow: "hidden", boxShadow: "0 8px 18px -12px rgba(33,29,24,0.25)", cursor: "pointer", display: "flex", flexDirection: "column" }}>
              <div style={{ height: 150, background: `linear-gradient(155deg, ${trip.cover[0]}, ${trip.cover[1]})`, position: "relative" }}>
                <button className="like-btn focus-ring" aria-label={liked ? `Unlike ${trip.title}` : `Like ${trip.title}`} onClick={(e) => { e.stopPropagation(); toggleLike(trip.id); }} style={{ position: "absolute", top: 10, right: 10, background: "rgba(237,231,221,0.88)", border: "none", borderRadius: "50%", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Heart size={14} color="#B85C38" fill={liked ? "#B85C38" : "none"} />
                </button>
                {trip.tagged && (
                  <div style={{ position: "absolute", bottom: 10, left: 10, display: "flex", alignItems: "center", gap: 4, background: "rgba(247,243,234,0.92)", borderRadius: 999, padding: "3px 9px", fontSize: 10, fontFamily: FONT_MONO, color: "#211D18" }}>
                    <ShoppingBag size={10} /> shop this
                  </div>
                )}
              </div>
              <div style={{ padding: "14px 14px 16px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#211D18", color: "#EDE7DD", fontSize: 9.5, fontFamily: FONT_MONO, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{initials(trip.author)}</div>
                  <span style={{ fontSize: 12, color: "#8A8172" }}>{trip.author}</span>
                </div>
                <div>
                  <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 500, margin: "0 0 3px" }}>{trip.title}</h3>
                  <div style={{ fontSize: 11.5, color: "#8A8172", display: "flex", alignItems: "center", gap: 4 }}>
                    <MapPin size={10} />
                    {trip.cities.join(" · ")}
                  </div>
                </div>
                <RouteStrip cities={trip.cities} />
                <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: "#8A8172" }}>{trip.duration} · {trip.dates}</span>
                <div style={{ display: "flex", gap: 4 }}>
                  {trip.palette.map((c, i) => <div key={i} style={{ width: 16, height: 16, borderRadius: 4, background: c }} />)}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 10, borderTop: "1px dashed #D8D0C0", fontSize: 11.5, color: "#8A8172" }}>
                  <span>{trip.itemCount} items packed</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Heart size={11} color={liked ? "#B85C38" : "#8A8172"} fill={liked ? "#B85C38" : "none"} />
                    {trip.likes + (liked ? 1 : 0)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ gridColumn: "1 / -1", border: "1.5px dashed #C9BFA9", borderRadius: 14, padding: "48px 24px", textAlign: "center", color: "#8A8172", fontSize: 14 }}>
            No trips match "{query}" yet.
          </div>
        )}
      </div>
    </div>
  );
}

function TripDetailScreen({ trip, pins, onBack }) {
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
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#211D18", color: "#EDE7DD", fontSize: 10.5, fontFamily: FONT_MONO, display: "flex", alignItems: "center", justifyContent: "center" }}>{initials(trip.author)}</div>
              <span style={{ fontSize: 13, color: "#8A8172" }}>{trip.author}</span>
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
  { id: "board", label: "Board", icon: LayoutGrid },
  { id: "watch", label: "Watch", icon: Bell },
  { id: "trip", label: "Trip", icon: Plane },
  { id: "shelf", label: "Shelf", icon: Library },
];

export default function App() {
  const [tab, setTab] = useState("board");
  const [pins, setPins] = useState(STARTER_PINS);
  const [tracked, setTracked] = useState(STARTER_TRACKED);
  const [openTrip, setOpenTrip] = useState(null);
  const [toast, setToast] = useState(null);

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

  const handleOpenTrip = useCallback((trip) => setOpenTrip(trip), []);
  const handleBackFromTrip = useCallback(() => setOpenTrip(null), []);

  const goToTab = useCallback((id) => {
    setOpenTrip(null);
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
        <TripDetailScreen trip={openTrip} pins={pins} onBack={handleBackFromTrip} />
      ) : tab === "board" ? (
        <MoodBoardScreen pins={pins} setPins={setPins} onTrackPrice={handleTrackPrice} />
      ) : tab === "watch" ? (
        <PriceTrackerScreen tracked={tracked} />
      ) : tab === "trip" ? (
        <TripPlannerScreen pins={pins} />
      ) : (
        <TripLibraryScreen pins={pins} onOpenTrip={handleOpenTrip} />
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
