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
// Big head, short legs, one round barrel of a body: a calf's proportions
// rather than a cow's, because the thing is 45 pixels across on the page
// and 24 in the bar, and at that size charm survives where anatomy does
// not. Every shape here is an ellipse, a rounded box, or one curve.
//
// The parts come out one at a time because the animal on the page is
// jointed: the legs swing, the head goes down to the grass, the tail
// keeps its own time. A joint needs a group of its own to turn in, and a
// group needs to know where it turns. The head's hinge is the one that
// had to be designed rather than found — see COW_HEAD_PIVOT.
//
// COW_PARTS puts them all back together standing still, which is what the
// button and the cursor want, so those two are one drawing with the
// page's cow rather than copies that have to be kept in step.
//
// Nothing here sets its own fill — the parent decides, because the button
// wants one flat colour and the page wants a pale animal with a dark
// outline, dark patches and a dark eye.

// The box it is drawn in. The animal is centred in it, because the page
// puts a cow down by its middle.
export const COW_BOX = { w: 64, h: 44 };
// Where its feet are. The shadow goes here, and so does the grass the
// head is trying to reach.
export const COW_GROUND = 36;

// Short and thick, with rounded ends, and the far pair a touch shorter so
// they start higher and still finish on the ground.
//
// A cow walks in four beats rather than two, one foot down after another:
// near hind, near fore, far hind, far fore. That is what the quarters are.
export const COW_LEGS = [
  { x: 26.5, y: 26, w: 4.6, h: 10, pivot: [28.8, 27], phase: 0.25 },
  { x: 32.6, y: 26.5, w: 4.6, h: 9.5, pivot: [34.9, 27.5], phase: 0.75 },
  { x: 44.4, y: 26, w: 4.6, h: 10, pivot: [46.7, 27], phase: 0 },
  { x: 50, y: 26.5, w: 4.6, h: 9.5, pivot: [52.3, 27.5], phase: 0.5 },
];
const legMarkup = (leg) =>
  `<rect x="${leg.x}" y="${leg.y}" width="${leg.w}" height="${leg.h}" rx="2.2"/>`;

// Up over the rump and down, with a tuft on the end.
export const COW_TAIL =
  '<path d="M51 8c4.6 0 7.2 3.3 7.2 7.6V22h-3.1v-6.4c0-2.6-1.7-4.4-4.1-4.4z"/>' +
  '<ellipse cx="56.6" cy="24.2" rx="2.5" ry="3.1"/>';
export const COW_TAIL_PIVOT = [52, 10];

export const COW_BODY = '<ellipse cx="39" cy="18" rx="15" ry="11"/>';

// The head, and the neck that carries it. They swing as one piece.
//
// The neck reaches a long way back into the body on purpose: that end of
// it moves when the head goes down, and inside the barrel is the one place
// it can move without showing. The ear and the horn are drawn before the
// head so the head covers their roots and leaves a nub and a leaf.
export const COW_NECK = '<path d="M34 14 19 16v11l15-1z"/>';
export const COW_EAR = '<path d="M16.8 12.4c1.2-3.1 4.6-4.4 6.3-2.8s.1 4.8-3.3 6z"/>';
export const COW_EAR_PIVOT = [17.6, 14.4];
export const COW_HORN = '<ellipse cx="10.6" cy="9.6" rx="1.9" ry="2.5"/>';
export const COW_SKULL = '<ellipse cx="13" cy="17" rx="9" ry="7.5"/>';
export const COW_MUZZLE = '<ellipse cx="6.5" cy="21" rx="5" ry="4.2"/>';
export const COW_EYE = '<circle cx="11.2" cy="15.6" r="1.9"/>';
export const COW_HEAD = COW_EAR + COW_HORN + COW_NECK + COW_SKULL + COW_MUZZLE;

// Where the head turns, which is the number the rest of the drawing was
// laid out around.
//
// A head goes down to the grass by turning, and turning moves a point at
// right angles to the arm holding it — so for the muzzle to travel
// straight down rather than swing backwards into the animal's own chest,
// the hinge has to be level with the muzzle and a long way behind it. This
// one is, and it is buried in the barrel where the neck can pivot on it
// without either end of the neck coming out from under the body.
export const COW_HEAD_PIVOT = [28, 21];

// The head and neck first, so the barrel covers the back of the neck.
export const COW_PARTS =
  COW_LEGS.map(legMarkup).join('') + COW_TAIL + COW_HEAD + COW_BODY;

// The dark markings. They mean nothing over a dark animal, so they are
// their own set: over the pale one they are the patches and the eye.
export const COW_PATCH_PARTS =
  '<ellipse cx="33" cy="12" rx="5.4" ry="3.9"/>' +
  '<ellipse cx="45.5" cy="20.5" rx="4.8" ry="3.6"/>';
export const COW_MARKS = COW_PATCH_PARTS + COW_EYE;

// Constants written in this file, never anything from outside it.
export function CowFigure() {
  return <g dangerouslySetInnerHTML={{ __html: COW_PARTS }} />;
}

export function CowPatches() {
  return <g dangerouslySetInnerHTML={{ __html: COW_PATCH_PARTS }} />;
}

export function CowJointed() {
  return (
    <>
      <g data-cow="shadow" opacity="0.1">
        <ellipse cx="0" cy="0" rx="16" ry="2.4" fill="#33383f" />
      </g>
      <g data-cow="frame">
        <g fill="#faf7ef" stroke="#33383f" strokeWidth="1.5" strokeLinejoin="round">
          {COW_LEGS.map((leg) => (
            <rect
              key={leg.x}
              data-cow="leg"
              x={leg.x}
              y={leg.y}
              width={leg.w}
              height={leg.h}
              rx="2.2"
            />
          ))}
          <g data-cow="tail" dangerouslySetInnerHTML={{ __html: COW_TAIL }} />
          <g data-cow="head">
            <g data-cow="ear" dangerouslySetInnerHTML={{ __html: COW_EAR }} />
            <g dangerouslySetInnerHTML={{ __html: COW_HORN + COW_NECK + COW_SKULL + COW_MUZZLE }} />
            {/* The eye is dark, and it is on the head, so it is inside the
                group the head turns in and not with the patches. */}
            <g fill="#33383f" stroke="none" dangerouslySetInnerHTML={{ __html: COW_EYE }} />
          </g>
          <g data-cow="bob" dangerouslySetInnerHTML={{ __html: COW_BODY }} />
        </g>
        {/* The patches are on the barrel, so they take the barrel's beat —
            which is why they are a second group marked the same way rather
            than part of the first. */}
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
