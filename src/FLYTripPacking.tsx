// FLYTripPacking.tsx
// The two screens wired together:
//   1. Swipe onboarding builds a closet from the archetype deck.
//   2. The trip planner runs the packing engine and shows the per-stop manifest.
//
// Drop this in src/ next to your engine files and render <FLYTripPacking /> from
// App.jsx. Styling is self-contained inline styles, no Tailwind or icon font
// needed, so it renders the same wherever you put it. Restyle freely.

import { useMemo, useState } from "react";
import { getSwipeDeck, closetFromSwipes } from "./archetypes";
import { buildPackingPlan } from "./packingEngine";
import type { ClosetItem, Trip, Stop } from "./packingEngine";
import { getStopWeather } from "./stopClimate";

// A planner stop carries the extras the weather lookup needs. It still satisfies
// the engine's Stop type, so it passes straight into buildPackingPlan.
type PlannerStop = Stop & { lat: number; lon: number; arrivalDate: string };

const ITALY_STOPS: PlannerStop[] = [
  { id: "rome", name: "Rome", nights: 2, tempHighC: 24, tempLowC: 14, rainChance: 0.1, activities: ["city", "dinner"], lat: 41.9028, lon: 12.4964, arrivalDate: "2026-09-23" },
  { id: "florence", name: "Florence", nights: 2, tempHighC: 21, tempLowC: 12, rainChance: 0.2, activities: ["city"], lat: 43.7696, lon: 11.2558, arrivalDate: "2026-09-25" },
  { id: "sorrento", name: "Sorrento", nights: 5, tempHighC: 26, tempLowC: 18, rainChance: 0.1, activities: ["beach", "hike", "city"], lat: 40.6263, lon: 14.3757, arrivalDate: "2026-09-27" },
  { id: "positano", name: "Positano", nights: 3, tempHighC: 27, tempLowC: 19, rainChance: 0.1, activities: ["beach", "dinner", "city"], lat: 40.6281, lon: 14.4850, arrivalDate: "2026-10-02" },
];

const t = {
  ink: "#1c1b19",
  muted: "#6f6c66",
  faint: "#9b9891",
  line: "#e7e4dd",
  surface: "#faf9f6",
  card: "#ffffff",
  accent: "#0e7c63",
  accentSoft: "#e4f1ec",
  warn: "#9a6212",
  warnSoft: "#f6ecd9",
};

const wrap: React.CSSProperties = {
  maxWidth: 480, margin: "0 auto", padding: "20px 16px 48px",
  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  color: t.ink,
};

export default function FLYTripPacking() {
  const [phase, setPhase] = useState<"onboarding" | "planner">("onboarding");
  const [closet, setCloset] = useState<ClosetItem[]>([]);

  return (
    <div style={{ background: t.surface, minHeight: "100%" }}>
      {phase === "onboarding" ? (
        <Onboarding
          onDone={(c) => { setCloset(c); setPhase("planner"); }}
        />
      ) : (
        <Planner closet={closet} onRestart={() => { setCloset([]); setPhase("onboarding"); }} />
      )}
    </div>
  );
}

// ---- screen 1: swipe onboarding -------------------------------------------

function Onboarding({ onDone }: { onDone: (closet: ClosetItem[]) => void }) {
  const deck = useMemo(() => getSwipeDeck(), []);
  const [i, setI] = useState(0);
  const [results, setResults] = useState<{ archetypeId: string; loved?: boolean }[]>([]);

  const finish = (all: typeof results) => onDone(closetFromSwipes(all));

  const swipe = (kind: "skip" | "own" | "love") => {
    const next = kind === "skip"
      ? results
      : [...results, { archetypeId: deck[i].id, loved: kind === "love" }];
    setResults(next);
    if (i + 1 >= deck.length) finish(next);
    else setI(i + 1);
  };

  const card = deck[i];
  const owned = results.length;

  return (
    <div style={wrap}>
      <div style={{ fontSize: 12, letterSpacing: 1, color: t.faint, fontWeight: 500 }}>FLY</div>
      <h2 style={{ fontSize: 20, fontWeight: 600, margin: "6px 0 4px" }}>Build your closet</h2>
      <p style={{ fontSize: 14, color: t.muted, margin: "0 0 18px", lineHeight: 1.5 }}>
        No photos. Just tap what you own. This seeds your wardrobe and learns your taste at the same time.
      </p>

      <div style={{ height: 4, background: t.line, borderRadius: 4, marginBottom: 20 }}>
        <div style={{ height: 4, width: `${(i / deck.length) * 100}%`, background: t.accent, borderRadius: 4, transition: "width .2s" }} />
      </div>

      <div style={{ background: t.card, border: `1px solid ${t.line}`, borderRadius: 16, padding: "40px 20px", textAlign: "center" }}>
        <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: t.faint, fontWeight: 600 }}>
          {card.category}
        </div>
        <div style={{ fontSize: 24, fontWeight: 600, margin: "12px 0 6px" }}>{card.name}</div>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", marginTop: 8 }}>
          {card.styleTags.slice(0, 3).map((s) => (
            <span key={s} style={{ fontSize: 11, color: t.muted, background: t.surface, border: `1px solid ${t.line}`, padding: "3px 9px", borderRadius: 20 }}>{s}</span>
          ))}
        </div>
      </div>

      <div style={{ textAlign: "center", fontSize: 12, color: t.faint, margin: "12px 0" }}>
        {i + 1} of {deck.length} &middot; closet: {owned}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => swipe("skip")} style={btn(false)}>Nope</button>
        <button onClick={() => swipe("own")} style={btn(true)}>Own it</button>
        <button onClick={() => swipe("love")} style={btn(true, true)}>Love</button>
      </div>

      <button onClick={() => finish(results)} style={{ ...btn(false), width: "100%", marginTop: 10, borderStyle: "dashed" }}>
        Done, see my packing list
      </button>
    </div>
  );
}

// ---- screen 2: trip planner + packing manifest ----------------------------

function Planner({ closet, onRestart }: { closet: ClosetItem[]; onRestart: () => void }) {
  const [stops, setStops] = useState<PlannerStop[]>(ITALY_STOPS);
  const [filter, setFilter] = useState<string>("all");
  const [loadingWx, setLoadingWx] = useState(false);

  const trip: Trip = { laundryEveryDays: 6, stops };
  const plan = useMemo(() => buildPackingPlan(closet, trip), [closet, stops]);

  const nights = stops.reduce((s, st) => s + st.nights, 0);
  const visibleStops = filter === "all" ? stops : stops.filter((s) => s.id === filter);

  // Optional: pull real weather per stop. Falls back to seeded values on failure.
  const refreshWeather = async () => {
    setLoadingWx(true);
    try {
      const updated = await Promise.all(stops.map(async (s) => {
        try {
          const w = await getStopWeather(s.lat, s.lon, s.arrivalDate);
          return { ...s, tempHighC: w.tempHighC, tempLowC: w.tempLowC, rainChance: w.rainChance };
        } catch {
          return s;
        }
      }));
      setStops(updated);
    } finally {
      setLoadingWx(false);
    }
  };

  return (
    <div style={wrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <div style={{ fontSize: 12, color: t.faint }}>Packing for</div>
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: "2px 0 0" }}>Italy, {nights} nights</h2>
          <div style={{ fontSize: 13, color: t.muted }}>Sep 23 to Oct 6 &middot; {stops.length} stops</div>
        </div>
        <button onClick={onRestart} style={{ ...btn(false), padding: "6px 12px", fontSize: 12 }}>Redo closet</button>
      </div>

      <div style={{ display: "flex", gap: 8, overflowX: "auto", margin: "16px 0 4px", paddingBottom: 4 }}>
        {stops.map((s) => {
          const hot = s.tempHighC >= 25;
          return (
            <div key={s.id} style={{ minWidth: 74, textAlign: "center", padding: "10px 8px", borderRadius: 12, background: hot ? t.accentSoft : t.card, border: `1px solid ${t.line}` }}>
              <div style={{ fontSize: 11, color: hot ? t.accent : t.muted, fontWeight: 500 }}>{s.name}</div>
              <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{s.tempHighC}&deg;</div>
              <div style={{ fontSize: 10, color: t.faint }}>low {s.tempLowC}&deg;</div>
            </div>
          );
        })}
      </div>

      <button onClick={refreshWeather} disabled={loadingWx} style={{ ...btn(false), width: "100%", fontSize: 12, padding: "8px", margin: "6px 0 18px" }}>
        {loadingWx ? "Updating weather..." : "Update with live weather"}
      </button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>From your closet</div>
        <div style={{ display: "flex", gap: 6 }}>
          {["all", ...stops.map((s) => s.id)].map((id) => (
            <span key={id} onClick={() => setFilter(id)} style={{ fontSize: 12, cursor: "pointer", padding: "4px 10px", borderRadius: 16, border: `1px solid ${filter === id ? t.accent : t.line}`, color: filter === id ? t.accent : t.muted, textTransform: "capitalize" }}>
              {id === "all" ? "All" : stops.find((s) => s.id === id)?.name}
            </span>
          ))}
        </div>
      </div>

      {visibleStops.map((s) => {
        const view = plan.byStop[s.id];
        return (
          <div key={s.id} style={{ marginBottom: 18 }}>
            {filter === "all" && <div style={{ fontSize: 12, fontWeight: 600, color: t.faint, textTransform: "uppercase", letterSpacing: 1, margin: "0 0 8px" }}>{s.name}</div>}
            {view.lines.map((line) => (
              <div key={line.itemId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${t.line}` }}>
                <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, padding: "3px 8px", borderRadius: 6, color: line.status === "pack" ? t.accent : t.muted, background: line.status === "pack" ? t.accentSoft : t.surface, minWidth: 46, textAlign: "center" }}>
                  {line.status}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14 }}>{line.name}</div>
                  <div style={{ fontSize: 11, color: t.faint }}>{line.roles.join(", ")}</div>
                </div>
              </div>
            ))}
            {view.gaps.map((g, k) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: t.warnSoft, border: `1px solid #ecdcb8`, borderRadius: 10, marginTop: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: t.warn, textTransform: "capitalize" }}>{g.slot}</div>
                  <div style={{ fontSize: 11, color: t.warn }}>{g.reason}</div>
                </div>
                <span style={{ fontSize: 12, color: t.warn, fontWeight: 500 }}>Shop &rarr;</span>
              </div>
            ))}
          </div>
        );
      })}

      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <Stat label="items packed" value={plan.stats.itemsPacked} />
        <Stat label="rewears" value={plan.stats.rewears} />
        <Stat label="gaps" value={plan.stats.gapCount} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ flex: 1, background: t.card, border: `1px solid ${t.line}`, borderRadius: 12, padding: "12px", textAlign: "center" }}>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: 11, color: t.muted }}>{label}</div>
    </div>
  );
}

function btn(filled: boolean, strong = false): React.CSSProperties {
  return {
    flex: 1,
    padding: "12px",
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    border: `1px solid ${filled ? t.accent : t.line}`,
    background: strong ? t.accent : filled ? t.accentSoft : t.card,
    color: strong ? "#fff" : filled ? t.accent : t.ink,
  };
}
