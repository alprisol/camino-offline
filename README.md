# Camino Offline

A phone-first offline map for four Camino Francés stages:

1. Sarria → Portomarín
2. Portomarín → Melide
3. Melide → O Pedrouzo
4. O Pedrouzo → Santiago de Compostela

The app bundles the basemap, GPX tracks, 65 useful bus stops, official scheduled services, and 126 drinking-water points. Bus and water markers cluster and appear progressively as the map is zoomed.

## Public map

The free GitHub Pages version is published at:

https://alprisol.github.io/camino-offline/

Every push to `main` rebuilds and deploys the static site through the workflow in `.github/workflows/deploy-pages.yml`.

## Run locally

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`.

To test the GitHub Pages build locally:

```powershell
npm run build:pages
```

## Use on a phone without signal

Open the published HTTPS site once while connected and wait for the header to say **Offline ready**. Add it to the phone’s home screen if desired. The 24 MB corridor basemap and all route data are then stored on the device.

Location access requires HTTPS (or `localhost`). The current-position button will ask for permission the first time it is used.

## Timetable snapshot

The bundled official Xunta schedule covers 27 July–2 August 2026 and includes the operator, line code, direction, arrival time, direct/transfer status, and on-demand flag. Intermediate stop times are approximate and schedules can change; check [bus.gal](https://www.bus.gal/) when connected before travelling.

## Refresh data

```powershell
node scripts/build-offline-data.mjs
```

Use `--water-only` to refresh only OpenStreetMap drinking-water points.

## Sources

- Bus stops and timetables: Transporte Público de Galicia, Xunta de Galicia (CC BY-SA 4.0)
- Drinking water: OpenStreetMap contributors (ODbL)
- Offline vector basemap: Protomaps / OpenStreetMap
