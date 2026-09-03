// MapLibre ≥ 5 spawns its tile worker as `new Worker('./maplibre-gl-worker.mjs', {type:'module'})` next to the
// main bundle. Vite's dep optimizer pre-bundles maplibre-gl.mjs into .vite/deps without that sibling, so the
// worker 404s silently and no tile is ever requested. Let Vite bundle the worker (with the shared chunk it
// imports) and hand MapLibre the resulting URL — valid in dev and in the production build.
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);
