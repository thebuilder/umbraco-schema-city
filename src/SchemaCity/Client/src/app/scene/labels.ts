// Which labels get drawn once every candidate is a box on screen. Pure: no
// three.js, no React, no DOM. Scene.tsx projects the anchors and paints what
// this keeps.
//
// Eight buildings in a row sit about 23 px apart when the camera frames the
// whole city, and a name is 80 to 140 px wide, so a row of labels is a pile
// unless something drops most of them. Nothing is lost: a hidden name is still
// one hover or one inspector row away.

/** Most labels on screen at once, however much room there is. */
export const LABEL_CAP = 40;
/** A building smaller than this on screen is too small to hang a name on. */
export const MIN_BUILDING_PX = 6;
/** Width of one character, when the scene has not measured the real font yet. */
export const CHAR_PX = 6.6;
/** Border, padding and the gap that keeps two kept labels from touching. */
const BOX_PAD_PX = 18;
/** Height of one label box, border and padding included. */
export const LABEL_HEIGHT_PX = 22;

export type LabelCandidate = {
  id: string;
  text: string;
  /** Lower wins the pixels. Selected is 0, hovered 1, everything else 2. */
  rank: number;
  /** Anchor in CSS pixels, the point the label sits centred above. */
  x: number;
  y: number;
  /** The building's footprint on screen, in pixels. 0 when it is behind the camera. */
  buildingPx: number;
  /** Skips the size cull. The node you picked or are pointing at keeps its name. */
  pinned?: boolean;
};

export type LabelBox = {
  id: string;
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

export function labelWidth(text: string, charPx = CHAR_PX): number {
  return text.length * charPx + BOX_PAD_PX;
}

const overlaps = (a: LabelBox, b: LabelBox) =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height;

/**
 * The labels worth drawing, in the order they were kept. Candidates are taken
 * best rank first and a candidate is dropped when its building is too small,
 * when its anchor is off screen, or when its box lands on one already kept.
 *
 * Ties keep the order they came in, because Array.prototype.sort is stable, so
 * the caller decides what a group of equal rank means.
 */
export function pickLabels(
  candidates: LabelCandidate[],
  options: {
    charPx?: number;
    cap?: number;
    minBuildingPx?: number;
    /** Viewport in CSS pixels. Anchors outside it are dropped. */
    width?: number;
    height?: number;
  } = {},
): LabelBox[] {
  const {
    charPx = CHAR_PX,
    cap = LABEL_CAP,
    minBuildingPx = MIN_BUILDING_PX,
    width = Number.POSITIVE_INFINITY,
    height = Number.POSITIVE_INFINITY,
  } = options;

  const kept: LabelBox[] = [];
  // ponytail: every kept box is compared against every other, which is 800
  // comparisons at the cap. A grid or an interval tree pays off past a few
  // hundred labels, and the cap is 40.
  for (const candidate of [...candidates].sort((a, b) => a.rank - b.rank)) {
    if (kept.length >= cap) break;
    if (!candidate.pinned && candidate.buildingPx < minBuildingPx) continue;
    if (candidate.x < 0 || candidate.x > width) continue;
    if (candidate.y < 0 || candidate.y > height) continue;

    const boxWidth = labelWidth(candidate.text, charPx);
    const box: LabelBox = {
      id: candidate.id,
      text: candidate.text,
      left: candidate.x - boxWidth / 2,
      // The anchor is the top face of the building, so the box sits above it.
      top: candidate.y - LABEL_HEIGHT_PX,
      width: boxWidth,
      height: LABEL_HEIGHT_PX,
    };
    if (kept.some((other) => overlaps(other, box))) continue;
    kept.push(box);
  }
  return kept;
}
