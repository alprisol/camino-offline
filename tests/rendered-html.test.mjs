import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", host: "localhost" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Camino app shell and metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Camino Offline — buses &amp; water<\/title>/i);
  assert.match(html, /Camino Francés/);
  assert.match(html, /Offline ready|Preparing offline map/);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /og\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|SkeletonPreview/i);
});

test("bundles the offline map, data, worker, and manifest", async () => {
  const data = JSON.parse(
    await readFile(new URL("../public/data/camino-data.json", import.meta.url), "utf8"),
  );
  assert.equal(data.stages.length, 4);
  assert.deepEqual(
    data.stages.map((stage) => stage.color),
    ["#FE575E", "#FEE252", "#61C27D", "#58CAE5"],
  );
  assert.deepEqual(
    data.routes.features.map((feature) => feature.properties.color),
    ["#FE575E", "#FEE252", "#61C27D", "#58CAE5"],
  );
  assert.equal(data.stops.length, 65);
  assert.ok(data.fountains.length >= 130);
  assert.ok(data.stops.every((stop) => stop.services.length > 0));
  assert.ok(
    data.stops.some((stop) =>
      stop.services.some((service) => service.date === data.timetableSnapshot.start),
    ),
  );

  const [, worker] = await Promise.all([
    access(new URL("../public/data/camino.pmtiles", import.meta.url)),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    access(new URL("../public/manifest.webmanifest", import.meta.url)),
    access(new URL("../public/og.png", import.meta.url)),
    access(new URL("../public/fonts/roboto/roboto-latin-variable.woff2", import.meta.url)),
    access(new URL("../public/icons/bus-silhouette.png", import.meta.url)),
    access(new URL("../public/icons/gps-position.png", import.meta.url)),
    access(new URL("../public/icons/santiago-shell.png", import.meta.url)),
  ]);
  assert.match(worker, /data\/camino\.pmtiles/);
  assert.match(worker, /fonts\/roboto\/roboto-latin-variable\.woff2/);
  assert.match(worker, /icons\/bus-silhouette\.png/);
  assert.match(worker, /icons\/gps-position\.png/);
  assert.match(worker, /icons\/santiago-shell\.png/);
  assert.match(worker, /postMessage\(\{ ok: true \}\)/);

  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(styles, /@font-face[\s\S]*roboto-latin-variable\.woff2/);
  assert.match(styles, /font-family: "Roboto Variable", Roboto, Arial, sans-serif/);
  assert.match(styles, /color-scheme: light only/);
  assert.doesNotMatch(styles, /font-family:\s*(?:Inter|Georgia|.*Times New Roman)/);

  const mapSource = await readFile(new URL("../app/CaminoMap.tsx", import.meta.url), "utf8");
  assert.match(mapSource, /id: "bus-clusters"[\s\S]*"icon-image": "bus-silhouette"/);
  assert.match(mapSource, /id: "water-clusters"[\s\S]*"icon-image": "water-drop-outline"/);
  assert.match(mapSource, /id: "cathedral-marker"[\s\S]*"icon-image": "santiago-shell"/);
  assert.match(mapSource, /CATHEDRAL_COORDINATES: Coordinates = \[-8\.5446277, 42\.8804004\]/);
});
