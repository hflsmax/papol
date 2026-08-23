import React from 'react';
import { animalFor } from './animals';

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



export function ToolGlyph({ id, animal }) {
  const Glyph = TOOL_GLYPHS[id];
  if (!Glyph) return null;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <Glyph animal={animal} />
    </svg>
  );
}

// The animal a reader can put on a page, in the groups each part turns in.
// The shapes come from animals.js; what is here is the skeleton they hang
// on, which is the same for every species.
//
// There is not one transform in this. Every one of them is written by
// cow.js, frame by frame, straight onto these groups — which is only safe
// so long as React is never rendering the same attribute, so it renders
// none of them. The `data-cow` marks are how the frame loop finds them
// once, when the animal is first put on the page.
// A rigged animal is not a pile of groups that turn — it is a fixed list
// of paths whose `d` is rewritten every frame. Nothing here has a
// transform on it at all except the two the loop owns, and React renders
// no `d`, so the two never argue over an attribute. See beasts.js for
// what the names mean and what order they go in.
function AnimalRigged({ spec }) {
  return (
    <>
      <g data-cow="shadow" opacity="0.1">
        <ellipse cx="0" cy="0" rx={spec.shadow.rx} ry="2.4" fill="#33383f" />
      </g>
      <g data-cow="frame" strokeWidth={spec.stroke}>
        {spec.rig.layers.map(([key, fill, stroke]) => (
          <path
            key={key}
            data-rig={key}
            fill={fill}
            stroke={stroke}
            strokeLinejoin={stroke === 'none' ? undefined : 'round'}
          />
        ))}
      </g>
    </>
  );
}

export function AnimalJointed({ spec }) {
  if (spec.rig) return <AnimalRigged spec={spec} />;
  const pale = {
    fill: '#faf7ef',
    stroke: '#33383f',
    // Not a constant: see `penFor` in animals.js. A species drawn small
    // needs a wider stroke in its own box to reach the page with the same
    // line on it as the rest.
    strokeWidth: spec.stroke,
    strokeLinejoin: 'round',
  };
  const dark = { ...pale, fill: '#33383f' };
  const skin = (part) => (part.dark ? dark : pale);
  return (
    <>
      <g data-cow="shadow" opacity="0.1">
        <ellipse cx="0" cy="0" rx={spec.shadow.rx} ry="2.4" fill="#33383f" />
      </g>
      <g data-cow="frame">
        <g {...(spec.legsDark ? dark : pale)}>
          {spec.legs.map((leg) => (
            <rect
              key={leg.x}
              data-cow="leg"
              x={leg.x}
              y={leg.y}
              width={leg.w}
              height={leg.h}
              rx={leg.rx ?? 2.5}
            />
          ))}
        </g>
        <g data-cow="tail" {...skin(spec.tail)}
          dangerouslySetInnerHTML={{ __html: spec.tail.markup }} />
        <g data-cow="bob">
          <g data-cow="head">
            {/* An ear that stands up is behind the head; an ear that hangs
                lies on the side of the face. Drawn in the wrong order the
                second kind simply is not there. */}
            {!spec.ear.over && (
              <g data-cow="ear" {...skin(spec.ear)}
                dangerouslySetInnerHTML={{ __html: spec.ear.markup }} />
            )}
            <g {...skin(spec.head)} dangerouslySetInnerHTML={{ __html: spec.head.markup }} />
            {spec.ear.over && (
              <g data-cow="ear" {...skin(spec.ear)}
                dangerouslySetInnerHTML={{ __html: spec.ear.markup }} />
            )}
            {/* The eye and the nose are on the head, so they belong in the
                group the head turns in and not with the body's markings. */}
            {spec.headMarks && (
              <g fill="#33383f" stroke="none"
                dangerouslySetInnerHTML={{ __html: spec.headMarks }} />
            )}
            {/* And pale, for a species whose face is the dark part. */}
            {spec.headLight && (
              <g fill="#faf7ef" stroke="none"
                dangerouslySetInnerHTML={{ __html: spec.headLight }} />
            )}
          </g>
          <g {...skin(spec.body)} dangerouslySetInnerHTML={{ __html: spec.body.markup }} />
          {spec.bodyMarks && (
            <g fill="#33383f" stroke="none"
              dangerouslySetInnerHTML={{ __html: spec.bodyMarks }} />
          )}
        </g>
        {/* And the same leg again, in front of the body this time, for the
            one or two a species ever lifts right up: a dog's hind foot at
            its own ear is on our side of the dog, and drawn behind the
            barrel it is not drawn at all. Only one of the pair is ever
            shown — see poseCow, which hands the leg over mid-swing — so
            this is a leg drawn twice and never seen twice. Outside the
            bob group, with the legs it belongs to, because a leg does not
            bob. */}
        {spec.overLegs.map((i) => (
          <g key={i} data-cow="over" display="none" {...(spec.legsDark ? dark : pale)}>
            <rect
              x={spec.legs[i].x}
              y={spec.legs[i].y}
              width={spec.legs[i].w}
              height={spec.legs[i].h}
              rx={spec.legs[i].rx ?? 2.5}
            />
          </g>
        ))}
      </g>
    </>
  );
}

// The button in the bar is not the animal.
//
// Every other glyph in this file is one silhouette with no interior
// detail, because at eighteen pixels that is all a glyph can be — a brush
// is its bristles, an eraser is its slant. The animals were the exception:
// the whole side view, shrunk, which at that size is a dark smudge with
// four legs somewhere inside it. Four legs, a tail and two ears is a lot
// of information to put through a hole that small, and none of it arrives.
//
// So each one is its head, seen face on — the one view of an animal that
// survives being eighteen pixels wide. A glyph stands for the tool; it is
// not a picture of what the tool leaves behind.
function AnimalTool({ animal }) {
  return (
    <g fill="currentColor" dangerouslySetInnerHTML={{ __html: animalFor(animal).glyph }} />
  );
}

const TOOL_GLYPHS = {
  arrow: ArrowTool,
  brush: BrushTool,
  eraser: EraserTool,
  laser: LaserTool,
  anchor: AnchorTool,
  here: HereTool,
  cow: AnimalTool,
};
