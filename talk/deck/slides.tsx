import "server-only"

import type { SlideDefinition } from "@thebuilder/deckard-core"
import { Close } from "@/deck/parts/close"
import { FakeOut } from "@/deck/parts/fake-out"
import { Fsn } from "@/deck/parts/fsn"
import { Layout } from "@/deck/parts/layout"
import { Legend } from "@/deck/parts/legend"
import { Live } from "@/deck/parts/live"
import { Morph } from "@/deck/parts/morph"
import { Pipeline } from "@/deck/parts/pipeline"
import { Placeholder } from "@/deck/parts/placeholder"
import { Takeover } from "@/deck/parts/takeover"
import { TheWall } from "@/deck/parts/the-wall"
import { UnixSystem } from "@/deck/parts/unix-system"
import { Whoami } from "@/deck/parts/whoami"
import { Wireframe } from "@/deck/parts/wireframe"

/*
 * The order and the speaker notes live here. Each visual lives in its own file
 * under deck/parts/, so the slides can be built in parallel without two people
 * editing the same lines. Timings add up to 25 minutes before questions.
 */
export const slides: SlideDefinition[] = [
  {
    slug: "fake-out",
    title: "Content Model Governance",
    notes:
      "Before the talk. Up on screen while people sit down. Play it straight and stand beside it like this is the talk. One click when you are ready.",
    header: "hidden",
    footer: "hidden",
    layout: "fullscreen",
    background: "none",
    body: <FakeOut />,
  },
  {
    slug: "takeover",
    title: "Schema City",
    notes:
      "0:00, 45 seconds. Let the takeover play without talking. When the title has settled: sorry, wrong deck.",
    header: "hidden",
    footer: "hidden",
    layout: "fullscreen",
    background: "hero",
    body: <Takeover />,
  },
  {
    slug: "whoami",
    title: "whoami",
    notes:
      "0:45, 1 minute. Who you are. Schema City is one of a growing set of Umbraco packages at umbraco.thebuilder.dk.",
    body: <Whoami />,
  },
  {
    slug: "the-wall",
    title: "The wall",
    notes:
      "1:45, 2 minutes. Ask the room what breaks if you change SEO Composition. Nobody can answer from this view, and that is the point. The timer keeps running until the live demo answers it.",
    layout: "fullscreen",
    body: <TheWall />,
  },
  {
    slug: "unix-system",
    title: "I know this",
    notes:
      "3:45, 1.5 minutes. Get the laugh. fsn was real SGI software from 1992. Directories were platforms, files were blocks, height was size. A kid read a filesystem in seconds because it was a place.",
    layout: "fullscreen",
    body: <UnixSystem />,
  },
  {
    slug: "fsn",
    title: "fsn.thebuilder.dk",
    notes:
      "5:15, 1.5 minutes. Your rebuild, running in the browser. Once you have a city engine, every graph looks like a city, and the graph you look at most at work is an Umbraco content model.",
    layout: "fullscreen",
    body: <Fsn />,
  },
  {
    slug: "morph",
    title: "Same data",
    notes:
      "6:45, 2 minutes. The thesis, with nothing written on screen. The data did not change, the interface did.",
    layout: "fullscreen",
    background: "statement",
    body: <Morph />,
  },
  {
    slug: "legend",
    title: "How to read it",
    notes:
      "8:45, 1 minute. Say each mapping once as it appears: doc type, property groups, properties, element types, traces.",
    body: <Legend />,
  },
  {
    slug: "live",
    title: "Live",
    notes:
      "9:45, 10 minutes. Switch to the backoffice. Overview, what is it connected to, the impact of changing SEO Composition (stop the timer from the wall), findings, compare against a snapshot.",
    background: "breaker",
    body: <Live />,
  },
  {
    slug: "pipeline",
    title: "Pipeline",
    notes:
      "19:45, 1.5 minutes. Their own world feeds the picture: Umbraco services, the graph API, the layout, the scene.",
    body: <Pipeline />,
  },
  {
    slug: "layout",
    title: "Layout",
    notes:
      "21:15, 1.5 minutes. Layout is the hard part. Show one decision it makes.",
    body: <Layout />,
  },
  {
    slug: "wireframe",
    title: "Wireframe",
    notes:
      "22:45, 1 minute 15. Why it stays fast with 200 document types: instancing and one glow pass.",
    body: <Wireframe />,
  },
  {
    slug: "close",
    title: "Go look at it",
    notes:
      "24:00. Leave this up through questions. Ask people to try it on their worst schema and open an issue.",
    background: "closing",
    body: <Close />,
  },
  {
    slug: "backup-impact",
    title: "Backup: impact",
    notes:
      "Backup. A change to SEO Composition reaches 37 types and 188 content items. Adding seoTitle collides on Dup Alias Page.",
    body: (
      <Placeholder
        label="backup"
        shows="Impact of changing SEO Composition, captured from the demo."
      />
    ),
  },
  {
    slug: "backup-findings",
    title: "Backup: findings",
    notes:
      "Backup. Findings, grouped by kind, breakages first. Each row says what it is about and what to do next.",
    body: (
      <Placeholder
        label="backup"
        shows="Findings, grouped by kind, captured from the demo."
      />
    ),
  },
  {
    slug: "backup-snapshot",
    title: "Backup: snapshot",
    notes:
      "Backup. Compare against a snapshot from before four planned edits: 4 causes, 48 side effects, 1 unplanned.",
    body: (
      <Placeholder
        label="backup"
        shows="Snapshot comparison, captured from the demo."
      />
    ),
  },
]
