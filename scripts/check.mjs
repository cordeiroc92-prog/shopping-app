/**
 * FLY regression checks — `npm run check`
 *
 * WHY THIS EXISTS
 * ---------------
 * `vite build` proves the file parses. It does not prove that the feed still
 * fetches, that affiliate links still carry their tracking, that a 14-day trip
 * still asks for 7 tops, or that nobody has nudged a hex in the colour tables
 * the recommendation engine scores against. Every one of those has broken here
 * at least once, silently, with a clean build.
 *
 * That matters most during a redesign. A visual pass can quietly delete a
 * `rel="sponsored"`, move the feed fetch back into a screen, or replace the
 * colour constants with "nicer" values, and nothing will look wrong.
 *
 * NO NEW DEPENDENCIES: esbuild (via Vite) transforms the JSX, react-dom/server
 * renders it. Both are already in node_modules.
 *
 * Run: npm run check        Exit code 0 = green, 1 = something regressed.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src", "App.jsx");

/* ------------------------------------------------------------------ runner */

let pass = 0;
const failures = [];
const groups = [];

function group(name) { groups.push(name); console.log(`\n${name}`); }
function check(label, fn) {
  try {
    const detail = fn();
    pass++;
    console.log(`  ok    ${label}${detail ? `  (${detail})` : ""}`);
  } catch (err) {
    failures.push({ label, message: err.message });
    console.log(`  FAIL  ${label}\n          ${err.message}`);
  }
}
function eq(actual, expected, what = "value") {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`);
  return a.length > 40 ? undefined : String(actual);
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

/* ----------------------------------------------- load App.jsx as a module */

const source = readFileSync(SRC, "utf8");

// Stub the things a headless render can't have: no network, no Supabase, no
// analytics, and icons as inert SVGs.
//
// These scratch files live inside node_modules, NOT in the OS temp dir: Node
// resolves a module's imports from that module's own location, so `import
// "react"` only works if the file sits under the project. (node_modules is
// already gitignored, so nothing leaks into a commit.)
const dir = join(ROOT, "node_modules", ".fly-check");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const stub = (name, body) => {
  const p = join(dir, name);
  writeFileSync(p, body);
  return pathToFileURL(p).href;
};

const icons = stub("icons.mjs", `
  import React from "react";
  const make = (n) => { const C = () => React.createElement("svg", { "data-icon": n }); C.displayName = n; return C; };
  export default new Proxy({}, { get: (_, k) => make(String(k)) });
`);
const analytics = stub("analytics.mjs", `export const track = () => {};`);
const supabase = stub("supabase.mjs", `export const supabase = null; export const supabaseReady = false;`);
const libStub = stub("libstub.mjs", `
  const noop = async () => null;
  export const fetchCloset = noop, pushClosetDiff = noop, adoptLocalCloset = noop,
    fetchClosetPublic = noop, pushClosetPublic = noop,
    fetchTrips = noop, upsertTrip = noop, deleteTrip = noop, adoptLocalTrips = noop,
    fetchLiked = noop, addLiked = noop, removeLiked = noop, adoptLocalLiked = noop,
    fetchTaste = noop, pushTaste = noop,
    fetchGarments = noop, addGarments = noop, updateGarment = noop,
    deleteGarment = noop, adoptLocalGarments = noop;
  export const newGarmentId = () => "g-test";
`);

// lucide-react exports named icons; the Proxy above is a default export, so
// rewrite that one import into a namespace destructure.
let patched = source
  .replace(/from "@vercel\/analytics"/, `from "${analytics}"`)
  .replace(/from "\.\/lib\/supabase\.js"/, `from "${supabase}"`)
  .replace(/from "\.\/lib\/(closet|trips|taste|garments)\.js"/g, `from "${libStub}"`)
  // [^}]* not [\s\S]*? — the latter starts matching at the FIRST `import {` in
  // the file and swallows every import above this one.
  .replace(/import \{([^}]*)\} from "lucide-react";/, (_m, names) =>
    `import __icons from "${icons}";\nconst {${names}} = __icons;`);

// Expose the internals worth asserting on. App.jsx exports only `App`.
patched += `
export { MatchCard, ShopTheLook, FeedScreen, ShelfScreen, ClosetScreen, TripPlannerScreen,
         Gateway, SetNewPassword, GarmentDetail,
         hasRealPrice, buyLinkFor, withAmazonTag, recommendFor, ownedCountFor,
         scoreAgainstBoard, colorDistance, resolveColour, inferClimate, adapterEssentialFor,
         essentialShows, CATALOG, SWATCHES, COLOUR_WORD_MAP, CLOSET_COLORS,
         WARDROBE_ARCHETYPES, STARTER_SUGGESTED, STARTER_OTHER, TABS, C,
         OCCASIONS, occasionSummary };
`;

const { transform } = await import("esbuild");
const { code } = await transform(patched, { loader: "jsx", format: "esm", target: "node18" });
const modPath = join(dir, "App.mjs");
writeFileSync(modPath, code);

// Browser globals the module touches at import time or first render.
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const A = await import(pathToFileURL(modPath).href);
const render = (Comp, props = {}) => renderToStaticMarkup(React.createElement(Comp, props));

/* ============================================================ 1. AFFILIATE */

group("Affiliate integrity — this is the revenue, and it breaks silently");

const catalogItem = A.CATALOG.find((i) => i.was && i.was > i.price) || A.CATALOG[0];
const awinItem = { ...catalogItem, id: "awin-test", store: "Ecosusi Fashion",
  sourceUrl: "https://www.awin1.com/pclick.php?p=40974665423&a=2991419&m=23275" };

check("an Awin deep link is tracked AND exact", () => {
  const r = A.buyLinkFor(awinItem);
  eq([r.tracked, r.exact], [true, true], "tracked/exact");
  eq(r.url, awinItem.sourceUrl, "url");
});

check("the Amazon fallback is tracked but NOT exact", () => {
  const r = A.buyLinkFor(catalogItem);
  eq([r.tracked, r.exact], [true, false], "tracked/exact");
  ok(r.url.includes("/s?k="), "fallback should be a keyword search");
});

check("every fallback link carries the Associates tag", () => {
  const missing = A.CATALOG.filter((i) => !A.buyLinkFor(i).url.includes("tag=feellikeyou-20"));
  eq(missing.length, 0, "items missing the tag");
  return `${A.CATALOG.length} catalog items`;
});

check("a tagged search still counts as tracked (drives rel=sponsored)", () => {
  ok(A.buyLinkFor(catalogItem).tracked === true,
    "a tagged Amazon search is a paid link and must be disclosed");
});

check("the outbound CTA is target=_blank + rel=sponsored", () => {
  const html = render(A.ShopTheLook, { item: awinItem });
  ok(html.includes('target="_blank"'), "missing target=_blank");
  ok(/rel="[^"]*sponsored/.test(html), "missing rel=sponsored on a tracked link");
  ok(/noopener/.test(html), "missing noopener");
});

check("the affiliate disclosure sits on the Shop the look screen", () => {
  const html = render(A.ShopTheLook, { item: awinItem });
  ok(/commission/i.test(html), "no commission disclosure near the CTA");
});

group("Price honesty — a price is a claim about the page you land on");

check("hasRealPrice is false for a keyword-search item", () => eq(A.hasRealPrice(catalogItem), false));
check("hasRealPrice is true for a deep-linked product", () => eq(A.hasRealPrice(awinItem), true));
check("hasRealPrice survives junk input", () => eq(A.hasRealPrice(undefined), false));

check("no price is rendered on a non-exact product", () => {
  const html = render(A.ShopTheLook, { item: catalogItem });
  ok(!html.includes(`$${catalogItem.price}`), "a price leaked onto a search-page link");
  ok(!html.includes("line-through"), "a struck-through price leaked onto a search-page link");
  ok(/Find on Amazon/.test(html), "CTA should say Find on Amazon when the link is a search");
});

check("the real price IS rendered on a deep-linked product", () => {
  const html = render(A.ShopTheLook, { item: awinItem });
  ok(html.includes(`$${awinItem.price}`), "a real price went missing");
});

check("the whole feed shows zero struck-through prices", () => {
  const html = render(A.FeedScreen, { liked: [], setLiked() {}, products: A.CATALOG });
  eq((html.match(/line-through/g) || []).length, 0, "strikethroughs");
  return `${A.CATALOG.length} cards`;
});

check("the feed fetch is wired into App, not into a screen", () => {
  // It lived in DiscoverScreen once. That screen left the nav, so the fetch
  // never ran: no product had a sourceUrl and every link in the app was an
  // untracked search. Nothing looked wrong.
  const app = source.slice(source.indexOf("export default function App()"));
  ok(/fetchFeedProducts\s*\(/.test(app), "App no longer calls fetchFeedProducts");
});

/* ======================================================== 2. PACKING ENGINE */

group("Packing engine — the product thesis, in numbers");

const hot = { maxHi: 31, minLo: 24, avgHi: 29, rainDays: 0, sunDays: 9 };
const cold = { maxHi: 8, minLo: 1, avgHi: 5, rainDays: 4, sunDays: 0 };
const coastalLegs = [{ id: "l1", coastal: true, nights: 5 }];
const inlandLegs = [{ id: "l2", coastal: false, nights: 5 }];
const row = (id) => A.STARTER_SUGGESTED.find((i) => i.id === id);

check("a 14-day trip asks for 7 tops", () => {
  eq(A.recommendFor(row("s1"), hot, inlandLegs, 14).qty, 7);
});
check("socks get one per day plus a spare", () => {
  eq(A.recommendFor(row("s21"), hot, inlandLegs, 14).qty, 15);
});
check("quantities clamp to the item's ceiling", () => {
  eq(A.recommendFor(row("s21"), hot, inlandLegs, 60).qty, 16, "qtyMax 16");
});
check("warm items stay hidden on a cold trip", () => {
  eq(A.recommendFor(row("s3"), cold, inlandLegs, 7).show, false, "shorts on an 8°C trip");
});
check("cold items stay hidden on a hot trip", () => {
  eq(A.recommendFor(row("s7"), hot, inlandLegs, 7).show, false, "a winter coat in 31°C");
});
check("swimwear needs a coastal stop", () => {
  eq(A.recommendFor(row("s15"), hot, inlandLegs, 7).show, false, "no coast, no swimwear");
  eq(A.recommendFor(row("s15"), hot, coastalLegs, 7).show, true, "coast, so swimwear");
});
check("rain gear needs rain in the forecast", () => {
  eq(A.recommendFor(row("s10"), hot, inlandLegs, 7).show, false, "dry forecast");
  eq(A.recommendFor(row("s10"), cold, inlandLegs, 7).show, true, "4 rain days");
});
check("gated items are hidden until the forecast lands", () => {
  // Otherwise a parka and a bikini appear together for a second and the list
  // looks broken.
  eq(A.recommendFor(row("s15"), null, coastalLegs, 7).show, false);
  eq(A.recommendFor(row("s19"), null, inlandLegs, 7).show, true, "ungated items still show");
});
check("the rationale line quotes the real forecast", () => {
  const r = A.recommendFor(row("s1"), hot, inlandLegs, 14);
  ok(/31/.test(r.reason), `reason should carry the temperature, got "${r.reason}"`);
});
check("sun gear shows in heat even with no sunny days", () => {
  eq(A.recommendFor(row("s12"), { ...hot, sunDays: 0 }, inlandLegs, 7).show, true, "UV is high under cloud");
});
check("long-trip essentials respect longMin", () => {
  const long = A.STARTER_OTHER.find((i) => i.longMin != null);
  if (!long) return "no longMin rows to test";
  eq(A.essentialShows(long, hot, 0, long.longMin - 1), false, "hidden on a short trip");
  eq(A.essentialShows(long, hot, 0, long.longMin), true, "shown once long enough");
});

group("Trip context — the second axis, alongside weather");

const occRow = (id) => A.STARTER_SUGGESTED.find((i) => i.id === id);

check("occasion rows are hidden when no context is set", () => {
  for (const r of A.STARTER_SUGGESTED.filter((i) => i.occasions)) {
    eq(A.recommendFor(r, hot, inlandLegs, 14, []).show, false, `${r.id} with no context`);
  }
  return A.STARTER_SUGGESTED.filter((i) => i.occasions).length + " occasion rows";
});
check("dinner plans surface a nicer dress and heels", () => {
  eq(A.recommendFor(occRow("o-dress"), hot, inlandLegs, 14, ["dinners"]).show, true);
  eq(A.recommendFor(occRow("o-heels"), hot, inlandLegs, 14, ["dinners"]).show, true);
});
check("dinner plans do NOT surface a black-tie gown", () => {
  eq(A.recommendFor(occRow("o-gown"), hot, inlandLegs, 14, ["dinners"]).show, false);
});
check("an event surfaces the gown, and shares the heels", () => {
  eq(A.recommendFor(occRow("o-gown"), hot, inlandLegs, 14, ["event"]).show, true);
  eq(A.recommendFor(occRow("o-heels"), hot, inlandLegs, 14, ["event"]).show, true, "shared across occasions");
});
check("occasion rows don't wait on the forecast", () => {
  // A wedding needs a gown whatever the temperature. Weather-gated rows are
  // hidden until the forecast lands; these must not be.
  eq(A.recommendFor(occRow("o-gown"), null, inlandLegs, 14, ["event"]).show, true);
});
check("occasion and weather both have to agree", () => {
  // Heeled SANDALS are open-toe: "nice dinner" shouldn't put them on a 5°C
  // city break. Occasion opens the door, the forecast can still close it.
  eq(A.recommendFor(occRow("o-heels"), cold, inlandLegs, 14, ["dinners"]).show, false, "sandals on a cold trip");
  eq(A.recommendFor(occRow("o-heels"), hot, inlandLegs, 14, ["dinners"]).show, true, "sandals on a warm trip");
  // Trousers for a work day are climate-agnostic — they should survive the cold.
  eq(A.recommendFor(occRow("o-trousers"), cold, inlandLegs, 14, ["work"]).show, true, "trousers on a cold trip");
});
check("a Set works as well as an array", () => {
  eq(A.recommendFor(occRow("o-blazer"), hot, inlandLegs, 14, new Set(["work"])).show, true);
});
check("every occasion kind has products to shop", () => {
  // Otherwise "Find it" dead-ends, which is worse than not suggesting it.
  const missing = A.STARTER_SUGGESTED
    .filter((i) => i.occasions && i.kind)
    .filter((i) => !A.CATALOG.some((c) => c.kind === i.kind))
    .map((i) => i.kind);
  eq(missing, [], "kinds with no catalog products");
});
check("every OCCASIONS entry actually changes the list", () => {
  // An option that adds nothing is a control that lies about doing something.
  // Asserted by effect rather than by mechanism: most contexts add occasion
  // rows, but "Beach days" instead satisfies the coastal gate, and an earlier
  // version of this check only knew about the first mechanism.
  const visible = (occ) =>
    A.STARTER_SUGGESTED
      .filter((i) => A.recommendFor(i, hot, inlandLegs, 14, occ).show)
      .map((i) => i.id)
      .sort()
      .join(",");
  const none = visible([]);
  for (const o of A.OCCASIONS) {
    ok(visible([o.id]) !== none, `context "${o.id}" changes nothing about the packing list`);
  }
  return A.OCCASIONS.length + " contexts";
});

check("Beach days turns swimwear on with no coastal stop", () => {
  // The geocoder flags a stop coastal; it can't know you're staying inland and
  // driving to a beach. The user saying so has to outrank it.
  const swim = A.STARTER_SUGGESTED.find((i) => i.id === "s15");
  eq(A.recommendFor(swim, hot, inlandLegs, 14, []).show, false, "inland, no beach plans");
  eq(A.recommendFor(swim, hot, inlandLegs, 14, ["beach"]).show, true, "inland, beach planned");
  const r = A.recommendFor(swim, hot, inlandLegs, 14, ["beach"]);
  ok(!/^0 coastal/.test(r.reason), `reason must not claim 0 coastal days, got "${r.reason}"`);
});
check("the context summary reads as a sentence", () => {
  eq(A.occasionSummary([]), null, "nothing chosen");
  ok(/Dinner plans/.test(A.occasionSummary(["dinners"])), "single occasion shows its note");
  ok(/·/.test(A.occasionSummary(["dinners", "work"])), "multiple occasions join");
});

group("Packing real pieces — the suitcase, not the abstraction");

check("only garments that fit a row are offered", () => {
  // A wool coat must never appear in the picker for tank tops. Same rule as
  // ownedCountFor: kind when both sides have one, category otherwise, always
  // filtered by climate.
  const tankRow = A.STARTER_SUGGESTED.find((i) => i.id === "s1");
  const closet = [
    { id: "g1", kind: "tank", category: "tops", climate: "warm" },
    { id: "g2", kind: "tank", category: "tops", climate: "warm" },
    { id: "g3", kind: "coat", category: "outerwear", climate: "cool" },
  ];
  // closetMatchesFor works on garments unchanged — they carry kind/category/climate.
  const matched = closet.filter((g) => A.ownedCountFor(tankRow, [], [g]) > 0).map((g) => g.id);
  eq(matched, ["g1", "g2"], "matching garments");
});

check("chosen pieces live on the packing row, so they persist", () => {
  // `suggested` is written whole to fly_trip_v1 and into the trip snapshot, so
  // putting garment ids on the row means they survive a refresh and reopen
  // with a saved trip — no new store, no migration.
  ok(/\{ \.\.\.i, pieces: next \}/.test(source), "chosen pieces are no longer stored on the row");
  ok(/trip: \{ startDate, endDate, countries, legs, suggested,/.test(source),
    "the snapshot no longer carries `suggested`, so pieces would not reopen with a trip");
});

check("packed is DERIVED, never stored twice", () => {
  // It was stored alongside the pieces, which meant a row could disagree with
  // its own contents — and pieces added from another screen could never flag
  // the row. Deriving it is what makes the Closet tab entry point possible.
  ok(/const isPacked = \(it\) => \{/.test(source), "isPacked is gone");
  ok(/if \(it\.packed\) return true;/.test(source), "a manual tick no longer wins");
  ok(!/pieces: next, packed/.test(source), "packed is being stored from pieces again");
  // Everything that asks "is this packed" must go through it.
  ok(/packFilter === "packed" \? hasPacked\(it\) : !isPacked\(it\)/.test(source), "the filter bypasses the derived helpers");
  ok(/const packedCount = allItems\.filter\(hasPacked\)/.test(source), "the count bypasses hasPacked");
});

check("a part-packed row still shows under Packed", () => {
  // One tank chosen from the closet is something you packed. A Packed tab that
  // only shows finished rows makes adding it feel like it did nothing — while
  // the tick and strike-through still wait for the row to be genuinely done.
  ok(/const hasPacked = \(it\) => !!it\.packed \|\| \(it\.pieces \|\| \[\]\)\.length > 0;/.test(source),
    "hasPacked is gone, so partial rows vanish from Packed");
  ok(/aria-checked=\{isPacked\(item\)\}/.test(source), "the tick must stay on the stricter test");
  ok(/opacity: isPacked\(item\) \? 0\.45 : 1/.test(source), "the strike-through must stay on the stricter test");
});

check("the two gaps stay in separate slots", () => {
  // Shopping gap (what to buy) is ownership-driven and must not move when you
  // pack; packing gap (what's still to go in the bag) counts down as you add.
  // Sharing one slot made the number jump from "5 more needed" to "6 more to
  // pack" after packing one item.
  ok(/\{covered \? "packed" : `\$\{gap\} more needed`\}/.test(source), "the shopping counter changed shape");
  ok(/toPack === 0 \? "all packed" : `\$\{toPack\} still to pack`/.test(source), "the packing countdown is gone");
  ok(/const toPack = Math\.max\(0, needed - chosenPieces\.length\)/.test(source), "toPack is no longer piece-driven");
});

check("nothing in your closet is refused", () => {
  // A packing list that won't let you pack your own shoes has the relationship
  // backwards. FLY's list is a suggestion, not a whitelist — anything with no
  // matching row packs as an extra instead of being greyed out.
  ok(!/disabled=\{!row\}/.test(source), "the closet picker disables unmatched garments again");
  ok(/setExtras\(\(cur\) => \(cur\.includes\(g\.id\) \? cur\.filter/.test(source),
    "unmatched garments no longer route to extras");
  ok(/also packing/.test(source), "extras have nowhere to appear in the list");
});

check("extras persist with the trip", () => {
  ok(/savedTripId, occasions, extras \}/.test(source), "extras are not written to fly_trip_v1");
  ok(/tripDays, occasions, extras \}/.test(source), "extras are not in the saved trip snapshot");
});

check("an uncategorised garment says why it didn't match", () => {
  // "Not needed for this trip" was wrong AND unhelpful: the real reason is that
  // the garment has no category yet, which the user can fix.
  ok(/set a category to match it/.test(source), "the unmatched reason is no longer actionable");
  ok(!/not needed for this trip/.test(source), "the misleading label is back");
});

check("a deleted photo can't leave a dangling thumbnail", () => {
  ok(/\.map\(\(id\) => garments\.find\(\(g\) => g\.id === id\)\)\s*\n?\s*\.filter\(Boolean\)/.test(source),
    "chosen pieces are not filtered against live garments");
});

group("Ownership — photographs beat swipes");

const tankArch = A.WARDROBE_ARCHETYPES.find((a) => a.kind === "tank");
check("archetype quantities count when there are no photos", () => {
  eq(A.ownedCountFor(row("s1"), [{ ...tankArch, qty: 3 }], []), 3);
});
check("real garments override the archetype estimate", () => {
  // Not 3 + 2 = 5. Someone who swiped "about 3" and then photographed 2 owns 2.
  const garments = [
    { id: "g1", kind: "tank", category: "tops", climate: "warm" },
    { id: "g2", kind: "tank", category: "tops", climate: "warm" },
  ];
  eq(A.ownedCountFor(row("s1"), [{ ...tankArch, qty: 3 }], garments), 2);
});
check("a garment of the wrong kind doesn't satisfy a row", () => {
  eq(A.ownedCountFor(row("s1"), [], [{ id: "g3", kind: "coat", category: "outerwear", climate: "cool" }]), 0);
});

group("Plug adapters");

check("a single-region trip gets that region's adapter", () => {
  const r = A.adapterEssentialFor([{ countryCode: "it" }, { countryCode: "fr" }]);
  ok(/European/i.test(r.label), `expected a European adapter, got "${r.label}"`);
});
check("a multi-region trip falls back to universal", () => {
  const r = A.adapterEssentialFor([{ countryCode: "it" }, { countryCode: "gb" }]);
  ok(/Universal/i.test(r.label), `expected universal, got "${r.label}"`);
});
check("an unmapped destination falls back to universal", () => {
  const r = A.adapterEssentialFor([{ countryCode: "zz" }]);
  ok(/Universal/i.test(r.label), "an unknown country must not get a confident wrong answer");
});

/* ================================================ 3. COLOUR / TASTE TABLES */

group("Garment-colour data — a hex edit here degrades ranking with no error");

// These tables feed colorDistance() and scoreAgainstBoard(). Changing a hex
// changes which products get recommended, and nothing throws, nothing looks
// wrong, the results are just quietly worse. So they're pinned by hash.
// If you INTENTIONALLY change one, update the hash in the same commit.
const hash = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 12);
const PINNED = {
  SWATCHES: "6fcd9c011ed9",
  COLOUR_WORD_MAP: "ef366f6470d5",
  CLOSET_COLORS: "ff419bf19f35",
  CATALOG_COLOURS: "07091f0d5330",
};
const actualHashes = {
  SWATCHES: hash(A.SWATCHES),
  COLOUR_WORD_MAP: hash(A.COLOUR_WORD_MAP),
  CLOSET_COLORS: hash(A.CLOSET_COLORS),
  CATALOG_COLOURS: hash(A.CATALOG.map((i) => [i.id, i.color])),
};

for (const [name, expected] of Object.entries(PINNED)) {
  check(`${name} is unchanged`, () => {
    if (expected.startsWith("__")) {
      throw new Error(`not pinned yet — paste this into PINNED.${name}: "${actualHashes[name]}"`);
    }
    eq(actualHashes[name], expected, name);
  });
}

check("colorDistance still behaves like a distance", () => {
  eq(A.colorDistance("#FFFFFF", "#FFFFFF"), 0, "identical colours");
  ok(A.colorDistance("#000000", "#FFFFFF") > A.colorDistance("#000000", "#333333"),
    "further apart should score further apart");
});
check("free-text colour names still resolve", () => {
  ok(/^#/.test(A.resolveColour("olive green")), "merchant colour names must resolve to a hex");
});
check("climate inference still reads titles", () => {
  eq(A.inferClimate("Packable rain jacket", "waterproof shell", "outerwear"), "rain");
});
check("scoreAgainstBoard never counts Amazon as a liked store", () => {
  const board = [{ ...catalogItem, store: "Amazon" }];
  const r = A.scoreAgainstBoard({ ...A.CATALOG[1], store: "Amazon" }, board);
  ok(!r.factors.some((f) => /already like Amazon/i.test(f.detail)),
    "Amazon is a marketplace, not a taste signal");
});

/* ========================================================= 4. EVERY SCREEN */

group("Every screen renders");

const screens = [
  ["Trips",          A.TripPlannerScreen, { pins: [], wardrobe: [], setWardrobe() {}, garments: [] }],
  ["Feed",           A.FeedScreen,        { liked: [], setLiked() {}, products: A.CATALOG }],
  ["Closet",         A.ClosetScreen,      { garments: [], onAdd() {}, onUpdate() {}, onRemove() {} }],
  ["You",            A.ShelfScreen,       { mode: "you", liked: [], savedTrips: [], wardrobe: [] }],
  ["You / closet",   A.ShelfScreen,       { mode: "closet", liked: [], savedTrips: [], wardrobe: [] }],
  ["You / trips",    A.ShelfScreen,       { mode: "trips", liked: [], savedTrips: [], wardrobe: [] }],
  ["Shop the look",  A.ShopTheLook,       { item: awinItem, liked: [] }],
  ["Garment detail", A.GarmentDetail,     { garment: { id: "g1", name: "", photo: null } }],
  ["Gateway",        A.Gateway,           { onEnter() {} }],
  ["Set password",   A.SetNewPassword,    { onDone() {} }],
  ["App root",       A.default,           {}],
];
for (const [name, Comp, props] of screens) {
  check(`${name} renders`, () => {
    const html = render(Comp, props);
    ok(html.length > 50, "rendered almost nothing");
    return `${html.length} chars`;
  });
}

check("a signed-out visitor gets the Gateway, not the app", () => {
  const html = render(A.default, {});
  ok(/Browse without an account/.test(html), "the landing page lost its guest path");
});

/* ============================================================== 5. LAYOUT */

group("Layout contract — the classes the media query depends on");

check("the app shell and both navs are present", () => {
  globalThis.localStorage = { getItem: (k) => (k === "fly_email" ? "" : null), setItem() {}, removeItem() {} };
  const html = render(A.default, {});
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  for (const c of ["fly-shell", "fly-main", "fly-rail", "fly-bottom-nav"]) {
    ok(new RegExp(`class="[^"]*${c}`).test(html), `missing .${c}`);
  }
  ok(!/class="fly-page"/.test(html), "the app must not use the gateway's page class");
});

check("the media query can actually hide what it targets", () => {
  // Inline styles beat stylesheets. The bottom tab bar carried an inline
  // display:flex, so `.fly-bottom-nav { display: none }` at >=1024px did
  // nothing and the phone tab bar rendered underneath the desktop rail.
  // Neither a static render nor jsdom evaluates media queries, so this is
  // asserted at the source: anything the breakpoint switches off must not set
  // `display` inline.
  const css = source.match(/const GLOBAL_STYLES = `([\s\S]*?)`;/)[1];
  const desktop = css.slice(css.indexOf("@media (min-width: 1024px)"));
  const hidden = [...desktop.matchAll(/\.([\w-]+)\s*\{[^}]*display:\s*none/g)].map((m) => m[1]);
  ok(hidden.length > 0, "the desktop block no longer hides anything — did the breakpoint move?");
  for (const cls of hidden) {
    const el = new RegExp(`className="[^"]*\\b${cls}\\b[^"]*"[^>]*?style=\\{\\{[^}]*display:`, "s");
    ok(!el.test(source), `.${cls} is hidden by the media query but sets display inline, which wins`);
  }
  return hidden.map((c) => "." + c).join(", ");
});

check("every row offers Find it, gap or no gap", () => {
  // Owning enough tops doesn't stop anyone wanting new ones, so the action is
  // no longer conditional on a shortfall.
  ok(!/\(!hasCloset \|\| gap > 0\) \? \(/.test(source), "Find it is conditional on a gap again");
  ok(/\{item\.category && \(\s*<button/.test(source), "the row action is gated on something other than having a category");
});

check("Find it opens the picker in Trips, not the Feed", () => {
  // It jumped straight to the Feed for a while. Packing is a task; losing your
  // place in the list to browse is the wrong direction for a gap.
  ok(/setShopItem\(\{ \.\.\.item, _needed: needed, _owned: have, _gap: gap \}\)/.test(source),
    "the row no longer opens the in-tab picker");
  ok(/surface: "packing", kind: item\.kind \|\| "unknown", covered: gap === 0/.test(source),
    "the row tap no longer reports itself as a packing find_it");
});

check("the picker offers Browse more as the way to the Feed", () => {
  ok(/Browse more in the Feed/.test(source), "no escape hatch from the shortlist");
  ok(/surface: "browse_more"/.test(source), "browse_more is not distinguishable from a row tap");
});

check("the packing filter needs a trip to exist", () => {
  // "Everything else" essentials are ungated, so allItems was 28 on a blank
  // canvas and the All/Packed/Needed control rendered above an empty state.
  ok(/\{timeline\.length > 0 && allItems\.length > 0 && \(/.test(source),
    "the filter no longer waits for an itinerary");
});

check("the gateway uses .fly-page and NEVER .fly-shell", () => {
  // It shared .fly-shell once. When that became flex-direction: row for the
  // desktop rail, the landing page laid its hero, feature cards and sign-in
  // card out side by side.
  const html = render(A.Gateway, { onEnter() {} });
  ok(/class="fly-page"/.test(html), "gateway lost .fly-page");
  ok(!/class="fly-shell"/.test(html), "gateway must not inherit the app shell's layout");
});

check("full-screen sheets carry .fly-sheet", () => {
  ok(/class="fly-sheet"/.test(render(A.ShopTheLook, { item: awinItem })), "Shop the look");
  ok(/class="fly-sheet"/.test(render(A.GarmentDetail, { garment: { id: "g", photo: null } })), "Garment detail");
});

check("feed titles are clamped to two lines", () => {
  // Unclamped titles made card heights alternate and every CTA sat at a
  // different height down the grid.
  const html = render(A.FeedScreen, { liked: [], setLiked() {}, products: A.CATALOG });
  ok(/-webkit-line-clamp:2/.test(html), "the two-line title clamp is gone");
  ok(/-webkit-box-orient:vertical/.test(html), "line-clamp needs box-orient to work");
});

check("feed photos are in a definite box, not sized by their own ratio", () => {
  const html = render(A.FeedScreen, { liked: [], setLiked() {}, products: A.CATALOG });
  ok(/position:absolute/.test(html), "photos need an absolutely positioned box or they overflow");
});

check("the empty-state CTA enters guided trip setup", () => {
  // It called setShowItinerary(true) directly at first, so `guided` stayed
  // false and the brand-new user — the only person the two-step setup exists
  // for — never saw it. Nothing looked broken.
  const m = source.match(/onClick=\{\(\) => \{ setGuided\(true\); setShowItinerary\(true\); \}\}/g) || [];
  ok(m.length >= 1, "the first-run CTA no longer turns on guided mode");
  ok(/setGuided\(true\);\s*\n\s*setShowItinerary\(true\);/.test(source) || m.length >= 1,
    "startFreshTrip no longer turns on guided mode");
});

check("the four tabs are intact", () => {
  eq(A.TABS.map((t) => t.id), ["trips", "feed", "closet", "shelf"], "tab order");
});

check("the palette tokens still exist", () => {
  for (const k of ["canvas", "wash", "ink", "muted", "line", "accent"]) {
    ok(typeof A.C[k] === "string" && A.C[k].startsWith("#"), `C.${k} is not a hex`);
  }
});

/* =============================================== 6. STATIC / SECURITY/ SEO */

group("Things outside App.jsx that a redesign tends to flatten");

const indexHtml = readFileSync(join(ROOT, "index.html"), "utf8");

check("the crawler fallback survives in index.html", () => {
  // This is what non-JS crawlers and affiliate reviewers see.
  ok(/<noscript|id="root"[\s\S]*?<a /.test(indexHtml) || /guides/.test(indexHtml),
    "the no-JS fallback content is gone");
  ok(/guides/.test(indexHtml), "the fallback lost its guide links");
});
check("the fonts are loaded from index.html", () => {
  ok(/Bricolage\+Grotesque/.test(indexHtml), "Bricolage Grotesque link missing");
  ok(/Inter/.test(indexHtml), "Inter link missing");
});
check("the viewport meta is intact", () => {
  ok(/name="viewport"/.test(indexHtml), "no viewport meta — mobile layout will not work");
});
check("the trust pages still exist", () => {
  const pages = ["privacy", "terms", "affiliate-disclosure", "about", "contact", "guides"];
  for (const p of pages) readFileSync(join(ROOT, "public", p, "index.html"));
  return pages.length + " pages";
});
check("no server-only key material in src/", () => {
  // Comments are stripped first: lib/supabase.js legitimately contains a
  // comment WARNING about service_role, and flagging the warning about the
  // thing is how a security check trains you to ignore it.
  const files = ["App.jsx", "main.jsx", "lib/supabase.js", "lib/closet.js", "lib/trips.js", "lib/taste.js", "lib/garments.js"];
  for (const f of files) {
    const code = readFileSync(join(ROOT, "src", f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    ok(!/service_role|sb_secret_/.test(code), `${f} uses a server-only key`);
    // A Supabase service key is a JWT; the publishable key is not.
    ok(!/["'`]eyJ[A-Za-z0-9_-]{20,}/.test(code), `${f} has a JWT-shaped literal — that's a secret, not a publishable key`);
  }
  return files.length + " files";
});
check("the preview sign-in bypass is still host-gated", () => {
  ok(/shopfeellikeyou\.com/.test(source) && /previewBypass/.test(source),
    "previewBypass must stay pinned to the production hostname");
});

/* ------------------------------------------------------------------ report */

console.log("\n" + "─".repeat(64));
if (failures.length === 0) {
  console.log(`${pass} checks passed.`);
  process.exit(0);
}
console.log(`${pass} passed, ${failures.length} FAILED:\n`);
for (const f of failures) console.log(`  • ${f.label}\n      ${f.message}`);
console.log("\nIf a failure is an intentional change, update the check in the same commit.");
process.exit(1);
