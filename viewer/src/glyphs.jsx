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
// Where its feet are. The shadow goes here, and so does the grass the head
// is trying to reach.
export const COW_GROUND = 36;

// Short, thick and round-ended, with the far pair a touch shorter so they
// start higher and still finish on the ground. Short because short legs
// are a young animal, and a young animal is the cute one.
//
// A cow walks in four beats rather than two, one foot down after another:
// near hind, near fore, far hind, far fore. That is what the quarters are.
export const COW_LEGS = [
  { x: 29, y: 28, w: 5, h: 8, pivot: [31.5, 29], phase: 0.25 },
  { x: 35, y: 28.5, w: 5, h: 7.5, pivot: [37.5, 29.5], phase: 0.75 },
  { x: 45.5, y: 28, w: 5, h: 8, pivot: [48, 29], phase: 0 },
  { x: 50.8, y: 28.5, w: 5, h: 7.5, pivot: [53.3, 29.5], phase: 0.5 },
];
const legMarkup = (leg) =>
  `<rect x="${leg.x}" y="${leg.y}" width="${leg.w}" height="${leg.h}" rx="2.5"/>`;

// Up over the rump, down, and a tuft on the end.
export const COW_TAIL =
  '<path d="M53.4 15.4c4 .8 5.7 4.2 5.2 8.2l-.7 5.3-2.5-.3.7-5.3c.3-2.5-.8-4.1-3.1-4.4z"/>' +
  '<ellipse cx="57.2" cy="30.6" rx="2.7" ry="3.3"/>';
export const COW_TAIL_PIVOT = [53.6, 16.2];

// One barrel, one head, and nothing between them.
//
// There was a neck here once, and it was the worst thing in the drawing: a
// four-cornered slab that read as a collar at rest and slid about across
// the body when the head went down. The head reaches back into the barrel
// instead and is drawn underneath it, so where the two meet is a join that
// never has to be got right — it is not visible.
//
// The head is carried high, above the line of the back rather than level
// with it. Level, the two shapes were one lumpy mass with a face on the
// end; up, the head has sky behind it and is its own thing, and the animal
// is looking at you rather than merely pointing that way. It also leaves
// somewhere for the head to go: the whole distance down to the grass is
// the animal's, and the grazing is worth watching because of it.
export const COW_BODY = '<rect x="26" y="14" width="30" height="17" rx="8.5"/>';
export const COW_SKULL = '<rect x="3" y="8" width="29" height="19" rx="8.5"/>';
export const COW_MUZZLE = '<ellipse cx="7" cy="22.5" rx="6" ry="5"/>';

// Two horns and one ear.
//
// Horns were tried twice as nubs — two upright lobes on the brow, with the
// ear a third behind them — and three lobes in a row across the top of a
// head is a rabbit. The shape that works is the crescent: a thin curve
// sweeping up and forward is a horn and cannot be read as anything else,
// at any size, which is exactly what the nubs could not manage. Without
// them the animal is a hippopotamus; four head designs were drawn side by
// side to be sure of it, and this was the only one anybody would call a
// cow.
export const COW_HORN =
  '<path d="M10.2 9.8c-2.9-2.6-3.3-6.8-.7-9.2.9 1.3-.4 2.4-.7 3.9-.2 2 .9 3.3 2.6 4.2z"/>' +
  '<path d="M15.6 9.4c-2.4-2.2-2.9-5.7-.7-7.9.8 1.1-.2 2.1-.4 3.3-.2 1.6.7 2.9 2.2 3.5z"/>';
// The ear goes behind them, long and swept back, and stays forward of the
// shoulder: the barrel is drawn over the head and swallows anything that
// reaches behind it.
export const COW_EAR = '<path d="M18.4 11c1-4.4 5.2-7.2 7.4-5.6s0 5.6-3.6 7.6z"/>';
export const COW_EAR_PIVOT = [19.6, 11.8];
// Big, and forward, and low on the head — high and small is a shrewd
// animal and this one is not meant to be.
export const COW_EYE = '<circle cx="14" cy="16" r="2.6"/>';
export const COW_NOSTRIL = '<ellipse cx="4.6" cy="22.2" rx="1.5" ry="1.2"/>';
export const COW_HEAD = COW_EAR + COW_HORN + COW_SKULL + COW_MUZZLE;

// Where the head turns.
//
// A head goes down to the grass by turning, and turning moves a point at
// right angles to the arm that holds it — so for the muzzle to travel down
// rather than swing backwards into the animal's own chest, the hinge has
// to be level with the muzzle and a long way behind it. This one is, and
// it is also just inside the barrel and just inside the back of the head:
// the back of the head barely moves, which is what keeps the join covered
// while the front of it goes all the way down.
export const COW_HEAD_PIVOT = [31, 22.5];

// The head first, so the barrel is drawn over the back of it.
export const COW_PARTS =
  COW_LEGS.map(legMarkup).join('') + COW_TAIL + COW_HEAD + COW_BODY;

// The dark markings. They mean nothing over a dark animal, so they are
// their own set: over the pale one they are the patches and the eye.
export const COW_PATCH_PARTS =
  '<ellipse cx="36" cy="19" rx="5.2" ry="3.8"/>' +
  '<ellipse cx="48" cy="26" rx="4.6" ry="3.4"/>';
export const COW_MARKS = COW_PATCH_PARTS + COW_EYE + COW_NOSTRIL;

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
        <ellipse cx="0" cy="0" rx="14" ry="2.4" fill="#33383f" />
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
              rx="2.4"
            />
          ))}
          <g data-cow="tail" dangerouslySetInnerHTML={{ __html: COW_TAIL }} />
          <g data-cow="bob">
            <g data-cow="head">
              <g data-cow="ear" dangerouslySetInnerHTML={{ __html: COW_EAR }} />
              <g dangerouslySetInnerHTML={{ __html: COW_HORN + COW_SKULL + COW_MUZZLE }} />
              {/* The eye is dark, and it is on the head, so it belongs in
                  the group the head turns in and not with the patches. */}
              <g fill="#33383f" stroke="none" dangerouslySetInnerHTML={{ __html: COW_EYE + COW_NOSTRIL }} />
            </g>
            <g dangerouslySetInnerHTML={{ __html: COW_BODY }} />
          </g>
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
    // Centred on the drawing's own bounds rather than on its box: the box
    // has room over the animal's back for a head that has been thrown up,
    // and a button that leaves that room empty looks like it is sitting
    // wrong in the bar.
    <g fill="currentColor" transform="translate(0.63 5.25) scale(0.369)">
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
