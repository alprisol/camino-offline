"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { layers, namedFlavor } from "@protomaps/basemaps";

type Coordinates = [number, number];

type Transfer = {
  at: string;
  arrive: string;
  depart: string;
  lineCode: string;
  lineName: string;
  operator: string;
};

type Service = {
  date: string;
  departure: string;
  arrival: string;
  lineCode: string;
  routeCode: string | null;
  lineName: string;
  itinerary: string;
  destination: string;
  operator: string;
  onDemand: boolean;
  schoolIntegration: boolean;
  frequency: string;
  season: string;
  transfer: Transfer | null;
};

type Stop = {
  id: number;
  name: string;
  coordinates: Coordinates;
  deviationM: number;
  routeKm: number;
  stageId: number;
  services: Service[];
};

type Fountain = {
  id: string;
  name: string;
  coordinates: Coordinates;
  deviationM: number;
  routeKm: number;
  stageId: number;
};

type Stage = {
  id: number;
  name: string;
  shortName: string;
  color: string;
  distanceKm: number;
  bounds: [Coordinates, Coordinates];
};

type CaminoData = {
  timetableSnapshot: {
    start: string;
    end: string;
    timezone: string;
    note: string;
  };
  stages: Stage[];
  routes: GeoJSON.FeatureCollection;
  stops: Stop[];
  fountains: Fountain[];
};

const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  timeZone: "Europe/Madrid",
});

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Madrid",
});

function canonicalDates(start: string) {
  const base = new Date(`${start}T12:00:00+02:00`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(base);
    date.setDate(date.getDate() + index);
    return date;
  });
}

function minutesBetween(departure: string, arrival: string) {
  const [depHour, depMinute] = departure.split(":").map(Number);
  const [arrHour, arrMinute] = arrival.split(":").map(Number);
  let result = arrHour * 60 + arrMinute - (depHour * 60 + depMinute);
  if (result < 0) result += 24 * 60;
  return result;
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function toPointCollection<T extends Stop | Fountain>(items: T[]) {
  return {
    type: "FeatureCollection" as const,
    features: items.map((item, index) => ({
      type: "Feature" as const,
      properties: {
        index,
        name: item.name,
        stageId: item.stageId,
        deviationM: item.deviationM,
      },
      geometry: {
        type: "Point" as const,
        coordinates: item.coordinates,
      },
    })),
  };
}

function StopSheet({
  stop,
  snapshotStart,
  onClose,
}: {
  stop: Stop;
  snapshotStart: string;
  onClose: () => void;
}) {
  const dates = useMemo(() => canonicalDates(snapshotStart), [snapshotStart]);
  const initialIndex = useMemo(() => {
    const today = new Date().getDay();
    const match = dates.findIndex((date) => date.getDay() === today);
    return match >= 0 ? match : 0;
  }, [dates]);
  const [selectedDay, setSelectedDay] = useState(initialIndex);

  useEffect(() => setSelectedDay(initialIndex), [stop.id, initialIndex]);

  const selectedDate = dates[selectedDay].toISOString().slice(0, 10);
  const services = stop.services.filter((service) => service.date === selectedDate);

  return (
    <section className="detail-sheet" aria-label={`Bus times for ${stop.name}`}>
      <div className="sheet-handle" aria-hidden="true" />
      <button className="close-button" type="button" onClick={onClose} aria-label="Close bus details">
        ×
      </button>
      <div className="sheet-kicker">
        <span className="bus-mini">B</span>
        Stage {stop.stageId} · km {stop.routeKm.toFixed(1)}
      </div>
      <h2>{stop.name}</h2>
      <p className="walk-away">
        {stop.deviationM < 80 ? "On the Camino" : `about ${stop.deviationM} m from the Camino`}
      </p>

      <div className="day-strip" role="tablist" aria-label="Choose timetable day">
        {dates.map((date, index) => (
          <button
            type="button"
            role="tab"
            aria-selected={selectedDay === index}
            className={selectedDay === index ? "day-button active" : "day-button"}
            onClick={() => setSelectedDay(index)}
            key={date.toISOString()}
          >
            <span>{DAY_FORMAT.format(date)}</span>
            <strong>{date.getDate()}</strong>
          </button>
        ))}
      </div>

      <div className="service-list" aria-live="polite">
        {services.length ? (
          services.map((service, index) => {
            const duration = minutesBetween(service.departure, service.arrival);
            return (
              <article
                className="service-card"
                key={`${service.date}-${service.departure}-${service.lineCode}-${index}`}
              >
                <div className="time-row">
                  <div>
                    <strong>{service.departure}</strong>
                    <span>depart</span>
                  </div>
                  <div className="journey-line">
                    <span>{formatDuration(duration)}</span>
                  </div>
                  <div>
                    <strong>{service.arrival}</strong>
                    <span>{service.destination}</span>
                  </div>
                </div>
                <div className="line-row">
                  <span className="line-code">{service.lineCode}</span>
                  <strong>{service.transfer ? "1 change" : "Direct"}</strong>
                </div>
                <p className="itinerary">{service.itinerary}</p>
                {service.transfer && (
                  <div className="transfer-box">
                    Change at <strong>{service.transfer.at}</strong> · arrive {service.transfer.arrive},
                    depart {service.transfer.depart} on {service.transfer.lineCode}
                  </div>
                )}
                <div className="service-meta">
                  <span>{service.operator}</span>
                  {service.onDemand && <span className="demand-chip">On request</span>}
                </div>
              </article>
            );
          })
        ) : (
          <div className="empty-day">
            <strong>No listed service</strong>
            <span>Try another day in this timetable snapshot.</span>
          </div>
        )}
      </div>

      <footer className="sheet-note">
        Official Xunta schedule snapshot for {DATE_FORMAT.format(dates[0])}–{DATE_FORMAT.format(dates[6])}.
        Intermediate times are approximate. On-request services should be confirmed at{" "}
        <a href="tel:+34981546100">981 546 100</a>.
      </footer>
    </section>
  );
}

function InfoSheet({ data, onClose }: { data: CaminoData; onClose: () => void }) {
  return (
    <section className="detail-sheet info-sheet" aria-label="Map information">
      <div className="sheet-handle" aria-hidden="true" />
      <button className="close-button" type="button" onClick={onClose} aria-label="Close map information">
        ×
      </button>
      <div className="sheet-kicker">Offline field guide</div>
      <h2>Know before you walk</h2>
      <p>
        The full basemap, all four GPX stages, {data.stops.length} useful boarding points, and{" "}
        {data.fountains.length} drinking-water points are stored on this device.
      </p>
      <div className="info-grid">
        <div>
          <strong>Bus data</strong>
          <span>Transporte Público de Galicia · Xunta de Galicia</span>
        </div>
        <div>
          <strong>Water & basemap</strong>
          <span>OpenStreetMap contributors · Protomaps</span>
        </div>
        <div>
          <strong>Timetable dates</strong>
          <span>{data.timetableSnapshot.start} to {data.timetableSnapshot.end}</span>
        </div>
      </div>
      <p className="source-warning">
        Schedules are a dated offline snapshot, not live information. Check{" "}
        <a href="https://www.bus.gal/" target="_blank" rel="noreferrer">bus.gal</a> before your trip
        whenever you have a connection.
      </p>
      <div className="legend">
        <span><i className="legend-bus">B</i> bus to the stage finish</span>
        <span><i className="legend-water" /> drinking water</span>
      </div>
    </section>
  );
}

export default function CaminoMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const locationMarker = useRef<Marker | null>(null);
  const [data, setData] = useState<CaminoData | null>(null);
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/data/camino-data.json")
      .then((response) => {
        if (!response.ok) throw new Error("Could not load Camino data");
        return response.json();
      })
      .then(setData)
      .catch(() => setLocationMessage("Map data could not be loaded."));
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        setOfflineReady(true);
        const resources = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((url) => url.startsWith(window.location.origin));
        registration.active?.postMessage({ type: "CACHE_RESOURCES", resources });
      } catch {
        setOfflineReady(false);
      }
    };
    register();
  }, []);

  useEffect(() => {
    if (!data || !mapContainer.current || mapRef.current) return;
    const protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);

    const basemapLayers = layers("protomaps", namedFlavor("light"), { lang: "es" }).filter(
      (layer) => layer.id !== "pois",
    );
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        glyphs: `${window.location.origin}/fonts/{fontstack}/{range}.pbf`,
        sprite: `${window.location.origin}/sprites/light`,
        sources: {
          protomaps: {
            type: "vector",
            url: `pmtiles://${window.location.origin}/data/camino.pmtiles`,
            attribution: "© OpenStreetMap contributors · Protomaps",
          },
        },
        layers: basemapLayers,
      },
      bounds: [
        [-8.61, 42.72],
        [-7.36, 42.98],
      ],
      fitBoundsOptions: { padding: { top: 92, bottom: 120, left: 28, right: 28 } },
      maxZoom: 17,
      minZoom: 8.8,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "top-right");

    map.on("load", () => {
      map.addSource("camino-routes", {
        type: "geojson",
        data: data.routes,
      });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "camino-routes",
        paint: {
          "line-color": "#ffffff",
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 5, 14, 9],
          "line-opacity": 0.92,
        },
      });
      map.addLayer({
        id: "route-lines",
        type: "line",
        source: "camino-routes",
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2.5, 14, 5],
          "line-opacity": 0.98,
        },
      });

      map.addSource("bus-stops", {
        type: "geojson",
        data: toPointCollection(data.stops),
        cluster: true,
        clusterMaxZoom: 13,
        clusterRadius: 48,
      });
      map.addLayer({
        id: "bus-clusters",
        type: "circle",
        source: "bus-stops",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#123d2e",
          "circle-radius": ["step", ["get", "point_count"], 16, 10, 19, 25, 23],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2.5,
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 9.4, 0, 10.4, 1],
          "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 9.4, 0, 10.4, 1],
        },
      });
      map.addLayer({
        id: "bus-cluster-count",
        type: "symbol",
        source: "bus-stops",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Medium"],
          "text-size": 12,
        },
        paint: {
          "text-color": "#ffffff",
          "text-opacity": ["interpolate", ["linear"], ["zoom"], 9.4, 0, 10.4, 1],
        },
      });
      map.addLayer({
        id: "bus-points",
        type: "circle",
        source: "bus-stops",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "#ffffff",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 8, 14, 13],
          "circle-stroke-color": "#123d2e",
          "circle-stroke-width": 3,
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 9.7, 0, 10.7, 1],
          "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 9.7, 0, 10.7, 1],
        },
      });
      map.addLayer({
        id: "bus-letter",
        type: "symbol",
        source: "bus-stops",
        filter: ["!", ["has", "point_count"]],
        layout: {
          "text-field": "B",
          "text-font": ["Noto Sans Medium"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 10, 9, 14, 13],
        },
        paint: {
          "text-color": "#123d2e",
          "text-opacity": ["interpolate", ["linear"], ["zoom"], 9.7, 0, 10.7, 1],
        },
      });

      map.addSource("fountains", {
        type: "geojson",
        data: toPointCollection(data.fountains),
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 34,
      });
      map.addLayer({
        id: "water-clusters",
        type: "circle",
        source: "fountains",
        filter: ["has", "point_count"],
        minzoom: 12.2,
        paint: {
          "circle-color": "#2b8fb8",
          "circle-radius": ["step", ["get", "point_count"], 9, 5, 12, 12, 15],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "water-points",
        type: "circle",
        source: "fountains",
        filter: ["!", ["has", "point_count"]],
        minzoom: 12.2,
        paint: {
          "circle-color": "#2b8fb8",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12.2, 4, 15, 7],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });

      map.on("click", "bus-clusters", async (event) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const source = map.getSource("bus-stops") as GeoJSONSource;
        const zoom = await source.getClusterExpansionZoom(Number(feature.properties?.cluster_id));
        map.easeTo({ center: feature.geometry.coordinates as Coordinates, zoom });
      });
      map.on("click", "bus-points", (event) => {
        const index = Number(event.features?.[0]?.properties?.index);
        if (Number.isFinite(index)) {
          setInfoOpen(false);
          setSelectedStop(data.stops[index]);
        }
      });
      map.on("click", "water-clusters", async (event) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const source = map.getSource("fountains") as GeoJSONSource;
        const zoom = await source.getClusterExpansionZoom(Number(feature.properties?.cluster_id));
        map.easeTo({ center: feature.geometry.coordinates as Coordinates, zoom });
      });
      map.on("click", "water-points", (event) => {
        const index = Number(event.features?.[0]?.properties?.index);
        const fountain = data.fountains[index];
        if (!fountain) return;
        new maplibregl.Popup({ closeButton: false, offset: 10 })
          .setLngLat(fountain.coordinates)
          .setHTML(
            `<strong>${fountain.name}</strong><span>${fountain.deviationM < 60 ? "On the Camino" : `${fountain.deviationM} m from the route`}</span>`,
          )
          .addTo(map);
      });

      const interactiveLayers = ["bus-clusters", "bus-points", "water-clusters", "water-points"];
      for (const layerId of interactiveLayers) {
        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      }
    });

    return () => {
      locationMarker.current?.remove();
      map.remove();
      maplibregl.removeProtocol("pmtiles");
      mapRef.current = null;
    };
  }, [data]);

  const focusStage = (stage: Stage) => {
    setSelectedStop(null);
    setInfoOpen(false);
    mapRef.current?.fitBounds(stage.bounds, {
      padding: { top: 96, bottom: 124, left: 30, right: 30 },
      duration: 850,
      maxZoom: 13.2,
    });
  };

  const locateUser = () => {
    if (!navigator.geolocation) {
      setLocationMessage("Location is not supported on this phone.");
      return;
    }
    setLocationMessage("Finding your position…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const position: Coordinates = [coords.longitude, coords.latitude];
        const element = document.createElement("div");
        element.className = "user-location-marker";
        locationMarker.current?.remove();
        locationMarker.current = new maplibregl.Marker({ element }).setLngLat(position).addTo(mapRef.current!);
        mapRef.current?.flyTo({ center: position, zoom: 15.4, duration: 900 });
        setLocationMessage(null);
      },
      () => setLocationMessage("Location permission is needed to find you."),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  };

  return (
    <main className="app-shell">
      <div ref={mapContainer} className="map-canvas" aria-label="Offline Camino de Santiago map" />

      <header className="map-header">
        <div className="brand-mark" aria-hidden="true">C</div>
        <div>
          <strong>Camino Francés</strong>
          <span className={offlineReady ? "status ready" : "status"}>
            <i /> {offlineReady ? "Offline ready" : "Preparing offline map"}
          </span>
        </div>
      </header>

      <button
        className="info-button"
        type="button"
        aria-label="Map information and data sources"
        onClick={() => {
          setSelectedStop(null);
          setInfoOpen(true);
        }}
      >
        i
      </button>

      {data && (
        <nav className="stage-menu" aria-label="Zoom to a Camino stage">
          {data.stages.map((stage) => (
            <button type="button" onClick={() => focusStage(stage)} key={stage.id}>
              <span className="stage-number" style={{ backgroundColor: stage.color }}>{stage.id}</span>
              <span className="stage-copy">
                <strong>{stage.shortName}</strong>
                <small>{stage.distanceKm} km</small>
              </span>
            </button>
          ))}
        </nav>
      )}

      <button className="locate-button" type="button" onClick={locateUser} aria-label="Zoom to my current position">
        <span aria-hidden="true" />
      </button>

      {locationMessage && <div className="toast" role="status">{locationMessage}</div>}

      {selectedStop && data && (
        <StopSheet
          stop={selectedStop}
          snapshotStart={data.timetableSnapshot.start}
          onClose={() => setSelectedStop(null)}
        />
      )}
      {infoOpen && data && <InfoSheet data={data} onClose={() => setInfoOpen(false)} />}

      {!data && (
        <div className="loading-card" role="status">
          <span />
          Loading your Camino…
        </div>
      )}
    </main>
  );
}
