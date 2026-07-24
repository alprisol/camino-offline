import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const XUNTA = "https://tpgal-ws-externos.xunta.gal/tpgal_ws/rest";
const SNAPSHOT_START = new Date("2026-07-27T00:00:00+02:00");
const SNAPSHOT_DAYS = 7;

const stageConfig = [
  {
    id: 1,
    name: "Sarria → Portomarín",
    shortName: "Portomarín",
    file: "camino-de-santiago-frances-1-de-6-desde-sarria-a-portomarin-.gpx",
    color: "#174f36",
    destinations: [270491, 2704936],
  },
  {
    id: 2,
    name: "Portomarín → Melide",
    shortName: "Melide",
    file: "camino-santiago-etapa-portomarin-melide.gpx",
    color: "#24714c",
    destinations: [150462, 15046145],
  },
  {
    id: 3,
    name: "Melide → O Pedrouzo",
    shortName: "O Pedrouzo",
    file: "melide-iglesia-de-santa-maria-de-melide-capilla-de-la-magdal.gpx",
    color: "#3c9261",
    destinations: [1506610],
  },
  {
    id: 4,
    name: "O Pedrouzo → Santiago",
    shortName: "Santiago",
    file: "pedrouzo-santiago-de-compostela-etapa-12-camino-primitivo.gpx",
    color: "#71b88b",
    destinations: [15078158, 15078139, 15078161],
  },
];

function parseGpx(xml) {
  const points = [];
  const matcher = /<trkpt\b[^>]*\blat="([^"]+)"[^>]*\blon="([^"]+)"/g;
  for (const match of xml.matchAll(matcher)) {
    points.push([Number(match[2]), Number(match[1])]);
  }
  if (points.length < 2) throw new Error("GPX track has fewer than two points");
  return points;
}

function haversine(a, b) {
  const radius = 6371;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function cumulativeDistances(points) {
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    cumulative.push(cumulative[i - 1] + haversine(points[i - 1], points[i]));
  }
  return cumulative;
}

function sampleTrack(points, cumulative, spacingKm) {
  const sampled = [{ point: points[0], km: 0 }];
  let target = spacingKm;
  for (let i = 1; i < points.length && target < cumulative.at(-1); i += 1) {
    while (cumulative[i] >= target) {
      const span = cumulative[i] - cumulative[i - 1] || 1;
      const ratio = (target - cumulative[i - 1]) / span;
      sampled.push({
        point: [
          points[i - 1][0] + (points[i][0] - points[i - 1][0]) * ratio,
          points[i - 1][1] + (points[i][1] - points[i - 1][1]) * ratio,
        ],
        km: target,
      });
      target += spacingKm;
    }
  }
  sampled.push({ point: points.at(-1), km: cumulative.at(-1) });
  return sampled;
}

function perpendicularDistance(point, lineStart, lineEnd) {
  const x = point[0];
  const y = point[1];
  const x1 = lineStart[0];
  const y1 = lineStart[1];
  const x2 = lineEnd[0];
  const y2 = lineEnd[1];
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  const projection = [x1 + t * dx, y1 + t * dy];
  return Math.hypot(x - projection[0], y - projection[1]);
}

function simplify(points, tolerance = 0.000045) {
  if (points.length <= 2) return points;
  let maxDistance = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpendicularDistance(points[i], points[0], points.at(-1));
    if (distance > maxDistance) {
      index = i;
      maxDistance = distance;
    }
  }
  if (maxDistance <= tolerance) return [points[0], points.at(-1)];
  const left = simplify(points.slice(0, index + 1), tolerance);
  const right = simplify(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

function nearestOnTrack(point, samples) {
  let best = { distanceKm: Number.POSITIVE_INFINITY, km: 0 };
  for (const sample of samples) {
    const distanceKm = haversine(point, sample.point);
    if (distanceKm < best.distanceKm) best = { distanceKm, km: sample.km };
  }
  return best;
}

async function fetchJson(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "CaminoOfflineMap/1.0" },
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 450 * attempt));
    }
  }
  throw lastError;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function runner() {
    while (index < items.length) {
      const current = index;
      index += 1;
      try {
        results[current] = await worker(items[current], current);
      } catch (error) {
        console.warn(`Request ${current + 1}/${items.length} failed: ${error.message}`);
        results[current] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function snapshotDates() {
  return Array.from({ length: SNAPSHOT_DAYS }, (_, index) => {
    const date = new Date(SNAPSHOT_START);
    date.setDate(date.getDate() + index);
    return date;
  });
}

function normalizeDirectService(service, date) {
  const departure = service.origin?.time;
  const arrival = service.destination?.time;
  if (!departure || !arrival) return null;
  return {
    date: isoDate(date),
    departure,
    arrival,
    lineCode: service.line_code || service.contract_code || String(service.line_id),
    routeCode: service.route_code || null,
    lineName: service.line_name,
    itinerary: service.route_name || service.expedition_name || service.line_name,
    destination: service.destination.busstop,
    operator: service.operator,
    onDemand: Boolean(service.on_demand || service.origin?.on_demand),
    schoolIntegration: Boolean(service.school_integration),
    frequency: service.week_frequency,
    season: service.anual_frequency,
    transfer: null,
  };
}

function normalizeTransferService(result, date) {
  const first = result.origin_expedition;
  const second = result.destination_expedition;
  if (!first?.origin?.time || !second?.destination?.time) return null;
  return {
    date: isoDate(date),
    departure: first.origin.time,
    arrival: second.destination.time,
    lineCode: first.contract_code || String(first.line_id),
    routeCode: null,
    lineName: first.line_name,
    itinerary: `${first.origin.busstop} → ${first.destination.busstop} → ${second.destination.busstop}`,
    destination: second.destination.busstop,
    operator: `${first.operator} + ${second.operator}`,
    onDemand: Boolean(first.on_demand || second.on_demand),
    schoolIntegration: Boolean(first.school_integration || second.school_integration),
    frequency: first.week_frequency,
    season: first.anual_frequency,
    transfer: {
      at: first.destination.busstop,
      arrive: first.destination.time,
      depart: second.origin.time,
      lineCode: second.contract_code || String(second.line_id),
      lineName: second.line_name,
      operator: second.operator,
    },
  };
}

async function directServices(stopId, destinationIds, date) {
  const dayMs = date.getTime();
  const requests = destinationIds.map((destinationId) => {
    const query = new URLSearchParams({
      origin_id: String(stopId),
      destination_id: String(destinationId),
      origin_type: "busstop",
      destination_type: "busstop",
      date: String(dayMs),
      page_size: "0",
    });
    return `${XUNTA}/service/search?${query}`;
  });
  const responses = await Promise.all(requests.map((url) => fetchJson(url)));
  return responses.flatMap((response) => response.results || []).map((service) => normalizeDirectService(service, date)).filter(Boolean);
}

async function transferServices(stopId, destinationId, date) {
  const query = new URLSearchParams({
    origin_id: String(stopId),
    destination_id: String(destinationId),
    date: String(date.getTime()),
    min_wait: "0",
    max_wait: "240",
    page_number: "1",
    page_size: "30",
  });
  const response = await fetchJson(`${XUNTA}/transfer/trip?${query}`);
  return (response.results || [])
    .filter((result) => Number(result.travel_time) <= 210)
    .map((result) => normalizeTransferService(result, date))
    .filter(Boolean);
}

async function fetchCandidateStops(stage) {
  const lookupSamples = sampleTrack(stage.points, stage.cumulative, 2.4);
  const urls = lookupSamples.map(({ point }) => {
    const query = new URLSearchParams({
      latitude: String(point[1]),
      longitude: String(point[0]),
      range: "2",
    });
    return `${XUNTA}/busstops/in-range?${query}`;
  });
  const responses = await mapLimit(urls, 6, (url) => fetchJson(url));
  const deduped = new Map();
  for (const response of responses.filter(Boolean)) {
    for (const stop of response.results || []) deduped.set(String(stop.id), stop);
  }
  const proximitySamples = sampleTrack(stage.points, stage.cumulative, 0.055);
  return [...deduped.values()]
    .map((stop) => {
      const point = [Number(stop.location.longitude), Number(stop.location.latitude)];
      const nearest = nearestOnTrack(point, proximitySamples);
      return {
        id: stop.id,
        sitmeId: stop.id_sitme || null,
        name: stop.text.replace(/\s+/g, " ").trim(),
        coordinates: point,
        deviationM: Math.round(nearest.distanceKm * 1000),
        routeKm: Number(nearest.km.toFixed(1)),
        stageId: stage.id,
      };
    })
    .filter((stop) => stop.deviationM <= 800 && stop.routeKm < stage.distanceKm - 0.5);
}

async function enrichStops(stage, candidates) {
  const dates = snapshotDates();
  const jobs = candidates.flatMap((stop) =>
    dates.map((date) => ({ stop, date })),
  );
  const directResults = await mapLimit(jobs, 8, async ({ stop, date }) => ({
    stopId: String(stop.id),
    date: isoDate(date),
    services: await directServices(stop.id, stage.destinations, date),
  }));
  const directByStop = new Map();
  for (const result of directResults.filter(Boolean)) {
    if (!directByStop.has(result.stopId)) directByStop.set(result.stopId, []);
    directByStop.get(result.stopId).push(...result.services);
  }

  const transferCandidates = candidates.filter((stop) => !(directByStop.get(String(stop.id)) || []).length);
  const transferJobs = transferCandidates.flatMap((stop) =>
    dates.map((date) => ({ stop, date })),
  );
  const transferResults = await mapLimit(transferJobs, 6, async ({ stop, date }) => ({
    stopId: String(stop.id),
    services: await transferServices(stop.id, stage.destinations[0], date),
  }));
  for (const result of transferResults.filter(Boolean)) {
    if (!directByStop.has(result.stopId)) directByStop.set(result.stopId, []);
    directByStop.get(result.stopId).push(...result.services);
  }

  return candidates
    .map((stop) => {
      const unique = new Map();
      for (const service of directByStop.get(String(stop.id)) || []) {
        const key = [service.date, service.departure, service.arrival, service.lineCode, service.destination, service.transfer?.lineCode].join("|");
        unique.set(key, service);
      }
      const services = [...unique.values()].sort((a, b) =>
        `${a.date}${a.departure}`.localeCompare(`${b.date}${b.departure}`),
      );
      return { ...stop, services };
    })
    .filter((stop) => stop.services.length > 0);
}

async function fetchWater(stages) {
  const elements = new Map();
  for (const stage of stages) {
    const minLon = Math.min(...stage.points.map((point) => point[0])) - 0.015;
    const minLat = Math.min(...stage.points.map((point) => point[1])) - 0.012;
    const maxLon = Math.max(...stage.points.map((point) => point[0])) + 0.015;
    const maxLat = Math.max(...stage.points.map((point) => point[1])) + 0.012;
    const bbox = `${minLat},${minLon},${maxLat},${maxLon}`;
    const query = `[out:json][timeout:60];node["amenity"="drinking_water"](${bbox});out body;`;
    let data = null;
    for (const endpoint of [
      "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
      "https://overpass.private.coffee/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
    ]) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 75_000);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "CaminoOfflineMap/1.0 (offline Camino map)",
          },
          body: new URLSearchParams({ data: query }),
          signal: controller.signal,
        });
        if (!response.ok) continue;
        data = await response.json();
        break;
      } catch {
        // Try the next public Overpass mirror.
      } finally {
        clearTimeout(timeout);
      }
    }
    if (!data) throw new Error("All Overpass mirrors failed");
    for (const element of data.elements || []) {
      elements.set(`${element.type}-${element.id}`, element);
    }
  }
  const stageSamples = stages.map((stage) => ({
    stage,
    samples: sampleTrack(stage.points, stage.cumulative, 0.04),
  }));
  const fountains = [];
  for (const element of elements.values()) {
    const lon = element.lon ?? element.center?.lon;
    const lat = element.lat ?? element.center?.lat;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const point = [lon, lat];
    let nearest = null;
    for (const candidate of stageSamples) {
      const match = nearestOnTrack(point, candidate.samples);
      if (!nearest || match.distanceKm < nearest.distanceKm) {
        nearest = { ...match, stageId: candidate.stage.id };
      }
    }
    if (!nearest || nearest.distanceKm > 0.6) continue;
    fountains.push({
      id: `osm-${element.type}-${element.id}`,
      name: element.tags?.name || element.tags?.description || "Drinking water",
      coordinates: point,
      stageId: nearest.stageId,
      routeKm: Number(nearest.km.toFixed(1)),
      deviationM: Math.round(nearest.distanceKm * 1000),
      source: "OpenStreetMap",
      osmUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    });
  }
  return fountains.sort((a, b) => a.stageId - b.stageId || a.routeKm - b.routeKm);
}

async function main() {
  await mkdir(path.join(ROOT, "public", "data"), { recursive: true });
  const stages = [];
  for (const config of stageConfig) {
    const xml = await readFile(path.join(ROOT, config.file), "utf8");
    const points = parseGpx(xml);
    const cumulative = cumulativeDistances(points);
    stages.push({
      ...config,
      points,
      cumulative,
      distanceKm: cumulative.at(-1),
    });
  }

  if (process.argv.includes("--water-only")) {
    const existingPath = path.join(ROOT, "public", "data", "camino-data.json");
    const existing = JSON.parse(await readFile(existingPath, "utf8"));
    console.log("Refreshing drinking-water points…");
    existing.fountains = await fetchWater(stages);
    existing.generatedAt = new Date().toISOString();
    await writeFile(existingPath, JSON.stringify(existing));
    console.log(`Wrote ${existing.fountains.length} fountains.`);
    return;
  }

  const routeFeatures = stages.map((stage) => ({
    type: "Feature",
    properties: {
      id: stage.id,
      name: stage.name,
      shortName: stage.shortName,
      color: stage.color,
      distanceKm: Number(stage.distanceKm.toFixed(1)),
    },
    geometry: {
      type: "LineString",
      coordinates: simplify(stage.points),
    },
  }));

  const allStops = [];
  for (const stage of stages) {
    console.log(`Finding stops for stage ${stage.id}…`);
    const candidates = await fetchCandidateStops(stage);
    console.log(`  ${candidates.length} candidates within 800 m`);
    const useful = await enrichStops(stage, candidates);
    console.log(`  ${useful.length} stops with useful service`);
    allStops.push(...useful);
  }

  console.log("Finding drinking-water points…");
  const fountains = await fetchWater(stages);
  console.log(`  ${fountains.length} fountains within 600 m`);

  const output = {
    generatedAt: new Date().toISOString(),
    timetableSnapshot: {
      start: isoDate(snapshotDates()[0]),
      end: isoDate(snapshotDates().at(-1)),
      timezone: "Europe/Madrid",
      note: "Official scheduled times snapshot. Intermediate-stop and arrival times are approximate and can change.",
    },
    sources: {
      transport: {
        name: "Transporte Público de Galicia — Xunta de Galicia",
        url: "https://www.bus.gal/",
        api: "https://tpgal-ws-externos.xunta.gal/",
        license: "CC BY-SA 4.0",
      },
      water: {
        name: "OpenStreetMap contributors",
        url: "https://www.openstreetmap.org/copyright",
        license: "ODbL",
      },
      basemap: {
        name: "Protomaps / OpenStreetMap",
        url: "https://protomaps.com/",
        build: "2026-07-24",
      },
    },
    stages: stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      shortName: stage.shortName,
      color: stage.color,
      distanceKm: Number(stage.distanceKm.toFixed(1)),
      bounds: [
        [
          Math.min(...stage.points.map((point) => point[0])),
          Math.min(...stage.points.map((point) => point[1])),
        ],
        [
          Math.max(...stage.points.map((point) => point[0])),
          Math.max(...stage.points.map((point) => point[1])),
        ],
      ],
    })),
    routes: {
      type: "FeatureCollection",
      features: routeFeatures,
    },
    stops: allStops,
    fountains,
  };

  await writeFile(
    path.join(ROOT, "public", "data", "camino-data.json"),
    JSON.stringify(output),
  );
  console.log(`Wrote ${allStops.length} useful stops and ${fountains.length} fountains.`);
}

await main();
