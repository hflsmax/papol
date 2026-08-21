import React from 'react';

// Two marks, one meaning each: an anchor holds a place, a note says
// something about it. Both are filled shapes in currentColor, so the same
// drawing serves as a pin on the page and as a bullet in the rail.

// The shape alone, for putting inside another drawing.
// The anchor, as one string. The pin on the page, the row in the rail and
// the cursor that drops one are all this shape, so "the same size as the
// actual anchor" is a fact about the drawing rather than a measurement
// somebody has to keep taking.
export const ANCHOR_D =
  'M12 1.4a3.3 3.3 0 1 1 0 6.6 3.3 3.3 0 1 1 0-6.6Zm0 1.9a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 1 0 0-2.8Z' +
  'M10.9 8.1h2.2v2.4h3.5v2.1h-3.5v5.1c1.5-.5 2.6-1.7 3-3.2l2 .6c-.6 2.7-2.9 4.7-5.9 5.1l-.2.1-.2-.1' +
  'c-3-.4-5.3-2.4-5.9-5.1l2-.6c.4 1.5 1.5 2.7 3 3.2v-5.1H7.4v-2.1h3.5Z';

// The point a pin marks, in the glyph's own units: its middle (see .pin).
// The cursor puts its hotspot on the same spot, so the anchor in hand and
// the anchor on the page agree about where they are.
export const ANCHOR_HANG = { x: 12, y: 12 };

export function AnchorPath() {
  return <path fill="currentColor" fillRule="evenodd" d={ANCHOR_D} />;
}

export function AnchorGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <AnchorPath />
    </svg>
  );
}

export function NoteGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8.6L6 21.4V17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
      />
    </svg>
  );
}

export function GlyphFor({ note }) {
  return note.content ? <NoteGlyph /> : <AnchorGlyph />;
}

// The four things a reader can be holding. Drawn to be told apart at the
// size a toolbar button actually gives them, which is why each has one
// silhouette and no interior detail: at 18px a brush is its bristles and
// an eraser is its slant.

function ArrowTool() {
  return (
    <path
      fill="currentColor"
      d="M5 2.2 5 20.4l4.6-4.5 2.9 5.9 3-1.5-2.9-5.8 6.1-.3Z"
    />
  );
}

function BrushTool() {
  return (
    <>
      {/* The handle, laid across the corner. */}
      <path
        fill="currentColor"
        d="M20.9 3.4a2.2 2.2 0 0 0-3.1 0l-7.6 7.6 3.1 3.1 7.6-7.6a2.2 2.2 0 0 0 0-3.1Z"
      />
      {/* The bristles, wider than the handle so the two read apart, and in
          whatever the brush is loaded with when anything has said. */}
      <path
        fill="var(--loaded, currentColor)"
        d="M8.6 12.7 4.9 16.4c-1.1 1.1-1.1 3 0 4.1s3 1.1 4.1 0l3.7-3.7Z"
      />
    </>
  );
}

function EraserTool() {
  return (
    <>
      <path
        fill="currentColor"
        d="M14.4 3.5 3.5 14.4a2.1 2.1 0 0 0 0 3l3.2 3.1a2.1 2.1 0 0 0 3 0L20.5 9.6a2.1 2.1 0 0 0 0-3l-3.1-3.1a2.1 2.1 0 0 0-3 0Z"
      />
      {/* The seam between rubber and sleeve, cut out of the block. */}
      <path fill="var(--card, #ffffff)" d="m9.6 8.3 1.4-1.4 6.1 6.1-1.4 1.4z" />
    </>
  );
}

function LaserTool() {
  return (
    <>
      <circle cx="12" cy="12" r="3.4" fill="currentColor" />
      {/* Pointing at something, rather than sitting on it. */}
      <path
        fill="currentColor"
        d="M11 2h2v4h-2zM11 18h2v4h-2zM2 11h4v2H2zM18 11h4v2h-4z"
      />
    </>
  );
}

// The two anchors are the marks they drop, so each button wears the shape
// the page will. They are the same shape: on the page the anchor that says
// where you are is the same drawing in gold, and a button that said
// otherwise would be describing a difference that is not there.
function AnchorTool() {
  return <AnchorPath />;
}

const HereTool = AnchorTool;



export function ToolGlyph({ id }) {
  const Glyph = TOOL_GLYPHS[id];
  if (!Glyph) return null;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <Glyph />
    </svg>
  );
}

// A cow, side on, facing left. Drawn once and used three times: as the
// button in the bar, as the cow on the cursor, and as the animal on the
// page, so what you pick up is what you put down.
//
// The parts come out one at a time because the animal on the page is
// jointed: the legs swing, the head goes down to the grass, the tail
// keeps its own time. A joint needs a group of its own to turn in, and a
// group needs to know where it turns — a leg at the shoulder, the head at
// the base of the neck, the tail at the rump. Pick the wrong point and
// the animal comes apart at it.
//
// COW_PARTS puts them all back together standing still, which is what
// the button and the cursor want, so those two are one drawing with the
// page's cow rather than copies of it that have to be kept in step.
//
// Nothing here sets its own fill — the parent decides, because the button
// wants one flat colour and the page wants a pale animal with a dark
// outline and patches.

// The box it is drawn in.
export const COW_BOX = { w: 64, h: 44 };

// The near side of the animal is the side facing the reader. A cow walks
// in four beats rather than two, one foot down after another, near hind,
// near fore, far hind, far fore — which is what the quarters are.
export const COW_LEGS = [
  { d: 'M22 27h3.2v12.5H22z', pivot: [23.6, 27], phase: 0.25 },
  { d: 'M29.5 28h3.2v11.5h-3.2z', pivot: [31.1, 28], phase: 0.75 },
  { d: 'M44 27h3.2v12.5H44z', pivot: [45.6, 27], phase: 0 },
  { d: 'M51 28h3.2v11.5h-3.2z', pivot: [52.6, 28], phase: 0.5 },
];

export const COW_TAIL =
  '<path d="M51.5 13.6c3.4 0 6 2.5 6.4 5.9l.4 3.4-2.8.3-.4-3.4c-.2-2-1.7-3.4-3.6-3.4z"/>';
export const COW_TAIL_PIVOT = [51.5, 14];

export const COW_BODY = '<ellipse cx="35" cy="20.5" rx="18" ry="9.6"/>';

// Neck into the head, then the head, then the ear, the horn and the
// muzzle. The ear is on its own because it flicks; the rest of the head
// swings as one piece about the base of the neck.
export const COW_NECK = '<path d="M20.5 16.5 14 21l4 9 6-4z"/>';
export const COW_SKULL = '<ellipse cx="13.5" cy="24" rx="7" ry="6"/>';
export const COW_EAR = '<path d="M14.2 18.4c1.9-2 4.2-1.6 5.2.4l-4.4 2z"/>';
// The ear's own base, where it meets the head.
export const COW_EAR_PIVOT = [15, 20.8];
export const COW_HORN = '<path d="M11.6 18.2 8.4 15.8c-.9 1.6-.2 3.2 1.4 3.7z"/>';
export const COW_MUZZLE = '<ellipse cx="7.6" cy="27" rx="4.2" ry="3.2"/>';
export const COW_HEAD = COW_NECK + COW_SKULL + COW_EAR + COW_HORN + COW_MUZZLE;
// Where the neck meets the shoulder — the midpoint of the edge the neck
// is attached to the body along, not the top corner of it. Hinged at the
// corner, a head going down to the grass swings backwards into its own
// chest instead: the muzzle is far out to the left of that point and
// barely below it, so turning about it is nearly a sideways sweep.
export const COW_HEAD_PIVOT = [22.3, 21.3];

// Legs first, so the body sits over the top of them.
export const COW_PARTS =
  COW_LEGS.map((leg) => `<path d="${leg.d}"/>`).join('') +
  COW_TAIL +
  COW_BODY +
  COW_HEAD;

// The patches, which only mean anything over a pale animal, so they go on
// top and only where the body has room for them. They belong to the body
// and ride with it.
export const COW_PATCH_PARTS =
  '<ellipse cx="28" cy="16.5" rx="5.6" ry="4"/>' +
  '<ellipse cx="43" cy="23" rx="4.6" ry="3.4"/>' +
  '<ellipse cx="36" cy="26" rx="3.2" ry="2.2"/>';

// Constants written in this file, never anything from outside it.
export function CowFigure() {
  return <g dangerouslySetInnerHTML={{ __html: COW_PARTS }} />;
}

export function CowPatches() {
  return <g dangerouslySetInnerHTML={{ __html: COW_PATCH_PARTS }} />;
}

// The animal as it stands on a page: the same parts again, each in the
// group it turns in, with the shadow it casts under the lot.
//
// There is not one transform in here. Every one of them is written by
// cow.js, frame by frame, straight onto these groups — which is only safe
// so long as React is never rendering the same attribute, so it does not
// render any of them. The `data-cow` marks are how the frame loop finds
// them once, when the cow is first put on the page.
export function CowJointed() {
  return (
    <>
      <g data-cow="shadow" opacity="0.1">
        <ellipse cx="0" cy="0" rx="17" ry="2.4" fill="#33383f" />
      </g>
      <g data-cow="frame">
        <g fill="#faf7ef" stroke="#33383f" strokeWidth="1.5" strokeLinejoin="round">
          {COW_LEGS.map((leg) => (
            <path key={leg.d} data-cow="leg" d={leg.d} />
          ))}
          <g data-cow="tail" dangerouslySetInnerHTML={{ __html: COW_TAIL }} />
          <g data-cow="bob">
            <g dangerouslySetInnerHTML={{ __html: COW_BODY }} />
            <g data-cow="head">
              <g dangerouslySetInnerHTML={{ __html: COW_NECK + COW_SKULL }} />
              <g data-cow="ear" dangerouslySetInnerHTML={{ __html: COW_EAR }} />
              <g dangerouslySetInnerHTML={{ __html: COW_HORN + COW_MUZZLE }} />
            </g>
          </g>
        </g>
        {/* The patches go on last, over the body — and take the body's
            beat, which is why they are a second group marked the same way
            rather than part of the first. */}
        <g data-cow="bob" fill="#33383f">
          <CowPatches />
        </g>
      </g>
    </>
  );
}

function CowTool() {
  return (
    <g fill="currentColor" transform="translate(0.4 2.6) scale(0.365)">
      <CowFigure />
    </g>
  );
}

const TOOL_GLYPHS = {
  arrow: ArrowTool,
  brush: BrushTool,
  eraser: EraserTool,
  laser: LaserTool,
  anchor: AnchorTool,
  here: HereTool,
  cow: CowTool,
};
