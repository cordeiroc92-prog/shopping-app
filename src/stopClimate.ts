// stopClimate.ts
// Feeds real per-stop weather into the packing engine.
//
// A trip weeks or months out has no live forecast, so this uses climate normals
// (the historical average for that place and time of year, over recent years) and
// switches to the live forecast once the dates fall inside the forecast horizon.
//
// Uses the free Open-Meteo endpoints. No API key. Runs in the browser or Node 18+.

export interface StopWeather {
  tempHighC: number;
  tempLowC: number;
  rainChance: number;   // 0..1
  source: "forecast" | "climate-normal";
}

const FORECAST_HORIZON_DAYS = 14;

function daysUntil(dateISO: string): number {
  const ms = new Date(dateISO).getTime() - Date.now();
  return Math.round(ms / 86_400_000);
}

// Live forecast for stops happening soon.
async function fetchForecast(lat: number, lon: number, dateISO: string): Promise<StopWeather> {
  const url = `https://api.open-meteo.com/v1/forecast`
    + `?latitude=${lat}&longitude=${lon}`
    + `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max`
    + `&start_date=${dateISO}&end_date=${dateISO}&timezone=auto`;
  const r = await fetch(url);
  const d = await r.json();
  return {
    tempHighC: Math.round(d.daily.temperature_2m_max[0]),
    tempLowC: Math.round(d.daily.temperature_2m_min[0]),
    rainChance: (d.daily.precipitation_probability_max[0] ?? 0) / 100,
    source: "forecast",
  };
}

// Climate normal: average the same short calendar window across recent years.
async function fetchClimateNormal(lat: number, lon: number, dateISO: string): Promise<StopWeather> {
  const target = new Date(dateISO);
  const mmdd = (dt: Date) => `${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  const window = 5;               // +/- days around the date, smooths noise
  const yearsBack = 5;

  const highs: number[] = [];
  const lows: number[] = [];
  const wetDays: number[] = [];

  const thisYear = new Date().getFullYear();
  for (let y = thisYear - yearsBack; y < thisYear; y++) {
    const start = new Date(y, target.getMonth(), target.getDate() - window);
    const end = new Date(y, target.getMonth(), target.getDate() + window);
    const fmt = (dt: Date) => `${dt.getFullYear()}-${mmdd(dt)}`;
    const url = `https://archive-api.open-meteo.com/v1/archive`
      + `?latitude=${lat}&longitude=${lon}`
      + `&start_date=${fmt(start)}&end_date=${fmt(end)}`
      + `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;
    const r = await fetch(url);
    const d = await r.json();
    const maxes: number[] = d.daily?.temperature_2m_max ?? [];
    const mins: number[] = d.daily?.temperature_2m_min ?? [];
    const precip: number[] = d.daily?.precipitation_sum ?? [];
    maxes.forEach((v) => v != null && highs.push(v));
    mins.forEach((v) => v != null && lows.push(v));
    precip.forEach((v) => wetDays.push(v != null && v >= 1 ? 1 : 0));
  }

  const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  return {
    tempHighC: Math.round(avg(highs)),
    tempLowC: Math.round(avg(lows)),
    rainChance: Number(avg(wetDays).toFixed(2)),  // share of days with meaningful rain
    source: "climate-normal",
  };
}

// One call per stop. Picks forecast or climate normal based on how far out it is.
export async function getStopWeather(
  lat: number, lon: number, arrivalDateISO: string,
): Promise<StopWeather> {
  const out = daysUntil(arrivalDateISO);
  if (out >= 0 && out <= FORECAST_HORIZON_DAYS) {
    try {
      return await fetchForecast(lat, lon, arrivalDateISO);
    } catch {
      // fall through to climate normal if the forecast call fails
    }
  }
  return fetchClimateNormal(lat, lon, arrivalDateISO);
}
