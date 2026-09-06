import { describe, expect, it } from "vitest";
import {
  CHAR_PX,
  LABEL_CAP,
  LABEL_HEIGHT_PX,
  type LabelCandidate,
  labelAnchors,
  labelWidth,
  pickLabels,
  visibleLabelIds,
} from "./labels";

function candidate(
  id: string,
  x: number,
  y: number,
  over: Partial<LabelCandidate> = {}
) {
  return { id, text: id, rank: 2, x, y, buildingPx: 20, ...over };
}

const idsOf = (boxes: { id: string }[]) => boxes.map((box) => box.id);

describe("pickLabels", () => {
  it("keeps both labels when their boxes miss each other", () => {
    const apart = labelWidth("a") + 10;
    const kept = pickLabels([
      candidate("a", 100, 100),
      candidate("b", 100 + apart, 100),
    ]);
    expect(idsOf(kept)).toEqual(["a", "b"]);
  });

  it("drops the lower priority label of an overlapping pair", () => {
    const kept = pickLabels([
      candidate("low", 104, 100, { rank: 2 }),
      candidate("high", 100, 100, { rank: 1 }),
    ]);
    expect(idsOf(kept)).toEqual(["high"]);
  });

  it("drops a label stacked half a box above one it kept", () => {
    const kept = pickLabels([
      candidate("ground", 100, 100),
      candidate("roof", 100, 100 - LABEL_HEIGHT_PX / 2),
    ]);
    expect(idsOf(kept)).toEqual(["ground"]);
  });

  it("stops at the cap even when every label fits", () => {
    const many = Array.from({ length: LABEL_CAP + 12 }, (_, i) =>
      candidate(`n${i}`, 100, i * (LABEL_HEIGHT_PX + 2))
    );
    expect(pickLabels(many)).toHaveLength(LABEL_CAP);
  });

  it("drops a label whose building is a few pixels across", () => {
    const kept = pickLabels([candidate("speck", 100, 100, { buildingPx: 3 })]);
    expect(kept).toEqual([]);
  });

  it("drops a label anchored off screen", () => {
    const kept = pickLabels([candidate("away", 900, 100)], {
      width: 800,
      height: 600,
    });
    expect(kept).toEqual([]);
  });

  it("keeps the selected label past the cap, the pile and a tiny building", () => {
    const crowd = Array.from({ length: LABEL_CAP + 20 }, (_, i) =>
      candidate(`n${i}`, 100 + i * 0.5, 100)
    );
    const kept = pickLabels([
      ...crowd,
      candidate("selected", 100, 100, { rank: 0, buildingPx: 2, pinned: true }),
    ]);
    expect(idsOf(kept)[0]).toBe("selected");
  });

  it("keeps the order it was given inside one rank", () => {
    const kept = pickLabels([
      candidate("first", 100, 100),
      candidate("second", 108, 100),
      candidate("third", 400, 100),
    ]);
    expect(idsOf(kept)).toEqual(["first", "third"]);
  });
});

describe("labelWidth", () => {
  it("grows with the name and leaves room for the padding", () => {
    expect(labelWidth("ab") - labelWidth("a")).toBeCloseTo(CHAR_PX);
    expect(labelWidth("")).toBeGreaterThan(0);
  });
});

it("keeps the idle overview unlabelled until a building is hovered or selected", () => {
  const idle = {
    hovered: null,
    selected: null,
    neighbours: null,
    focusNeighbours: null,
  };
  expect([...visibleLabelIds(idle)]).toEqual([]);
  expect([...visibleLabelIds({ ...idle, hovered: "type" })]).toEqual(["type"]);
  expect([...visibleLabelIds({ ...idle, selected: "type" })]).toEqual(["type"]);
});

it("places a selected type label and usage badge above its current roof", () => {
  const at = {
    id: "type",
    position: { x: 2, z: 3 },
    y: 4,
    footprint: 2,
    height: 1,
    floors: 1,
    district: "pages",
    districtKind: "structure" as const,
    introDelay: 0,
  };
  const labels = labelAnchors(new Set(["type"]), {
    nodesById: new Map([["type", { name: "A type" }]]),
    placementsById: new Map([["type", at]]),
    heights: new Map([["type", 6]]),
    selected: "type",
    hovered: null,
    badge: "2 published",
  });
  expect(labels.map((label) => label.text)).toEqual(["A type", "2 published"]);
  expect(labels[0]?.y).toBeCloseTo(10.35);
  expect(labels[1]?.lift).toBe(LABEL_HEIGHT_PX + 4);
});

it("keeps density and usage badges distinct when a selected type is hovered", () => {
  const at = {
    id: "type",
    position: { x: 2, z: 3 },
    y: 4,
    footprint: 2,
    height: 1,
    floors: 1,
    district: "pages",
    districtKind: "structure" as const,
    introDelay: 0,
  };
  const labels = labelAnchors(new Set(["type"]), {
    nodesById: new Map([
      [
        "type",
        {
          name: "A type",
          ownPropertyCount: 3,
          composedPropertyCount: 2,
          groups: [{}],
        },
      ],
    ]),
    placementsById: new Map([["type", at]]),
    heights: new Map([["type", 6]]),
    selected: "type",
    hovered: "type",
    badge: "2 published",
  });
  expect(labels.map((label) => label.id)).toEqual([
    "type",
    "type:properties",
    "type:usage",
  ]);
  expect(labels[2]?.lift).toBe((LABEL_HEIGHT_PX + 4) * 2);
});
