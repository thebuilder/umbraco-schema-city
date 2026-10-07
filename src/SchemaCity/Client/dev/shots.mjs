// Captures the README and marketplace screenshots from the dev harness over CDP.
//
//   npx vite dev dev -c vite.config.ts --host 127.0.0.1 --port 5206
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
//     --remote-debugging-port=9333 --hide-scrollbars --user-data-dir=/tmp/schema-city-shots
//   node dev/shots.mjs ../../../docs/screenshots [name...]
//
// Every shot starts from a fresh navigation, because the app reads the query string
// once on mount. `medium.json` is the harness's first fixture, so it is the one the
// picker already has, and its usage report loads with it.
import { writeFileSync } from "node:fs";
import { quantise } from "./quantise.mjs";

const out = process.argv[2] ?? ".";
/** Names to capture, or all of them when none are named. */
const only = process.argv.slice(3);
const HARNESS = process.env.HARNESS ?? "http://127.0.0.1:5206/";
const CDP = process.env.CDP ?? "http://127.0.0.1:9333";
const ALL_LAYERS = "structure,compositions,blocks,references";

const targets = await (await fetch(`${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => {
  ws.onopen = resolve;
});

let id = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) pending.get(message.id)(message);
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, (m) => resolve(m.result ?? m.error));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Evaluate in the page and throw on anything the expression reports as a miss. */
async function run(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
  });
  const value = result.result?.value;
  if (result.exceptionDetails)
    throw new Error(
      `${expression}: ${JSON.stringify(result.exceptionDetails)}`
    );
  if (value === "miss") throw new Error(`no element for: ${expression}`);
  return value;
}

/** Click the first button whose text matches, from anywhere in the page. */
const clickButton = (pattern, nth = 1) =>
  run(`(() => {
    const hits = [...document.querySelectorAll("button")].filter((b) => ${pattern}.test(b.textContent || ""));
    if (hits.length < ${nth}) return "miss";
    hits[${nth} - 1].click();
    return "ok";
  })()`);

/** Drag across the canvas, which orbits the camera: sideways turns it, upwards lowers it. */
async function orbit(from, to) {
  const at = (type, [x, y]) =>
    send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
  const step = (i) => [
    from[0] + ((to[0] - from[0]) * i) / 12,
    from[1] + ((to[1] - from[1]) * i) / 12,
  ];
  await at("mousePressed", from);
  // biome-ignore lint/performance/noAwaitInLoops: the drag is one ordered stream of moves.
  for (let i = 1; i <= 12; i++) await at("mouseMoved", step(i));
  await at("mouseReleased", to);
}

/** Turn the wheel over the canvas, which dollies the camera toward the cursor. */
async function wheel([x, y], ticks) {
  for (let i = 0; i < ticks; i++) {
    // biome-ignore lint/performance/noAwaitInLoops: the wheel is one ordered stream of turns.
    await send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      deltaX: 0,
      deltaY: -120,
    });
    await wait(120);
  }
}

const shots = [
  // The whole city on the default layer, nothing selected. All four layers at once
  // is a hairball at this width: the compositions fan alone crosses the frame a
  // hundred times and the districts under it stop reading. free-camera is the shot
  // that shows the other three.
  { name: "city", query: "?layers=structure" },
  // Closer in on Site's neighbourhoods, where the printed names come out whole and
  // the courtyards, vias and gold fingers on the boards can be read.
  {
    name: "names",
    query: "?layers=structure",
    async after() {
      await wheel([700, 430], 14);
      await wait(1500);
    },
  },
  // Home focused: its neighbourhood is rebuilt in place and the inspector is open.
  { name: "focus", query: "?type=home&focus=1&layers=structure" },
  // The findings drawer over the default city.
  {
    name: "findings",
    query: "?layers=structure",
    async after() {
      await clickButton("/^Findings/i");
      await wait(900);
    },
  },
  // The Content count lens with Article selected, so the inspector prints its usage.
  { name: "lens", query: "?type=article&lens=count&layers=structure" },
  // The table, sorted by own properties, most first. The first click sorts ascending.
  {
    name: "list",
    query: "?view=list",
    async after() {
      await clickButton("/^Own/i");
      await clickButton("/^Own/i");
      await wait(400);
    },
  },
  // What an editor can create where, with Home selected under Site.
  { name: "tree", query: "?view=tree&type=home" },
  // Compositions per type, most used first.
  { name: "matrix", query: "?view=matrix" },
  // Home laid out the way the content editor shows it.
  { name: "editor", query: "?view=editor&type=home" },
  // Orbited round and down to a few degrees above the ground, where the city meets
  // the horizon.
  {
    name: "free-camera",
    query: `?layers=${ALL_LAYERS}`,
    async after() {
      await orbit([800, 640], [900, 470]);
      await wait(1400);
    },
  },
];

await send("Page.enable");
// The harness's fixture picker is scaffolding, not product, so it stays out of the
// shots. Injected on every navigation, before the app mounts, so the scene measures
// the viewport it is actually photographed at.
await send("Page.addScriptToEvaluateOnNewDocument", {
  // The first-visit hint is for people, not for the README, so every shot is a
  // return visit.
  source: `try { localStorage.setItem("schema-city:hint-seen", "1"); } catch {}
  document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = ".demo-footer { display: none }";
    document.head.append(style);
  });`,
});
await send("Emulation.setDeviceMetricsOverride", {
  width: 1600,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});

for (const shot of shots) {
  if (only.length > 0 && !only.includes(shot.name)) continue;
  // biome-ignore lint/performance/noAwaitInLoops: one browser, so the shots are taken one at a time.
  await send("Page.navigate", { url: HARNESS + shot.query });
  // The fixture fetch, the lazy scene chunk, layout, and the establishing shot.
  await wait(7000);
  await shot.after?.();
  const png = await send("Page.captureScreenshot", { format: "png" });
  const file = `${out}/${shot.name}.png`;
  // Chrome writes 24-bit PNGs of a city that is mostly dithered fog, which lands
  // between 130 and 420 kB. A 256-colour palette holds every colour this UI uses and
  // brings the heaviest shot to about a quarter of that. A smaller scale factor was
  // the other option and it made the files bigger, because resampling the dither
  // costs more than the pixels it saves.
  writeFileSync(file, quantise(Buffer.from(png.data, "base64")));
  console.log("wrote", file);
}
ws.close();
