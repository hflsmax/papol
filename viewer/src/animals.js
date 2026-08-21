// The animals a reader can put on a page.
//
// All five are the same beast underneath: a barrel, a neck, a head, four
// legs and a tail, each in the group it turns in. What differs between a
// cow and a cat is proportion and a handful of shapes — which is the whole
// reason they are records in a list rather than five drawings. One engine
// walks all of them (see cow.js), and adding a sixth is a matter of
// writing down where its legs are.
//
// The rules the cow was got right under, which the rest inherit:
//
//  - The head is drawn under the barrel, and it turns. Anything that turns
//    sweeps, so a shape tucked under the body at rest comes out from under
//    it at twenty degrees. The neck therefore ends in a circle centred on
//    the head's pivot: a circle centred on the point it turns about does
//    not move when it turns, so it is covered at every angle, and the neck
//    in front of it may be any shape at all.
//  - The pivot sits roughly level with the muzzle and a long way behind
//    it, so that turning carries the muzzle down to the grass rather than
//    backwards into the animal's own chest.
//  - Nothing sets its own fill. The parent decides, because the page wants
//    a pale animal with a dark outline and dark markings, and the button
//    wants one flat colour.

// One thing an animal does, with everything it does not care about left
// out. `head` is degrees — positive down to the floor, negative up to look
// at something — and `wag` is the working it does while it is there: a
// size and a rate. A cow nuzzling, a dog snuffling, a pig rooting and a
// cat washing are all this one oscillation at four very different sizes,
// and that is most of what tells them apart.
//
// `tilt` drops the rear (a dog sitting) and `sink` lowers the whole body
// (a cat crouching). Both only ever bring the body nearer its own feet,
// which is what makes them safe: the legs are drawn under the body, so a
// body that comes down covers more of them and never less.
const act = (id, o) => ({
  id,
  weight: 1,
  span: [1400, 3600],
  head: 0,
  wag: [0, 0],
  ear: 0,
  tilt: 0,
  sink: 0,
  walks: false,
  ...o,
});

// How an animal carries itself. These are the cow's, which were the ones
// tuned by eye against a rendered page; every other species says only how
// it differs.
//
// The two that matter most for character are `beat` and `duty`. `beat` is
// strides a second at walking pace — but it is tied to the animal's actual
// speed, not to the clock, so feet never run on ahead of the ground.
// `duty` is the fraction of a stride a foot spends down: high is a plod,
// where a foot is planted and the body travels over it, and low is a trot,
// where the legs spend as long in the air as on the ground. A cow and a
// dog differ more in that one number than in anything about their outlines.
const DEFAULT_WAYS = {
  // Page-fractions a millisecond. A cow crossing a page in half a minute
  // is a cow.
  speed: 0.00003,
  // Getting up to speed and coming to a stop. An animal that reaches its
  // walking pace in one frame is a vehicle.
  ease: 350,
  // How long a whole turn takes, through zero — not a mirroring.
  turn: 260,
  beat: 2,
  swing: 15,
  duty: 0.65,
  // How far the body rises in the middle of a stride.
  bob: 0.9,
  // How long the body takes to settle into whatever it has decided to do.
  nod: 320,
  // How much it wanders up and down the page as well as across it. A page
  // is not a field.
  drift: 0.3,
  // The tail an activity gets if it does not ask for its own. On an animal
  // standing still for half a minute this is most of what says the thing
  // is alive rather than printed.
  swish: 14,
  swishRate: 0.0029,
  earEvery: [3800, 9000],
  earHeld: 130,
  earBack: 30,
  // And the big one: a fly on the flank, and the tail goes right over the
  // back after it. The arc is signed because half a turn arrives at the
  // same place either way, but one way goes over the back and the other
  // sweeps the tail forward through the animal's own belly.
  swatEvery: [9000, 22000],
  swatHeld: 640,
  swatArc: -180,
  // And the things it does. The cow's, since the cow is the default in
  // everything else too: it eats, it chews what it ate, it looks up, and
  // now and then it walks somewhere.
  acts: [
    act('graze', { weight: 4, span: [2600, 7000], head: 29, wag: [1.4, 0.004] }),
    act('chew', { weight: 2, span: [1800, 4200], head: 9, wag: [0.9, 0.012], ear: 0.15 }),
    act('gaze', { weight: 1, span: [1200, 2600], head: -8 }),
    act('amble', { weight: 3, span: [1400, 3600], walks: true }),
  ],
};

const legRect = (leg) =>
  `<rect x="${leg.x}" y="${leg.y}" width="${leg.w}" height="${leg.h}" rx="${leg.rx ?? 2.5}"/>`;

// The four beats of a walk, one foot down after another: near hind, near
// fore, far hind, far fore. Every animal here walks the same way; only the
// legs it does it on are different.
const GAIT = [0.25, 0.75, 0, 0.5];

// Four legs from two positions and two lengths, since the far pair is only
// ever the near pair moved over and shortened enough to keep its feet on
// the ground.
function legsFor({ fore, hind, top, len, w, rx, lean = 0.5 }) {
  return [
    { x: fore, y: top, w, h: len, rx, pivot: [fore + w / 2, top + 1], phase: GAIT[0] },
    { x: fore + w + lean, y: top + lean, w, h: len - lean, rx,
      pivot: [fore + w + lean + w / 2, top + lean + 1], phase: GAIT[1] },
    { x: hind, y: top, w, h: len, rx, pivot: [hind + w / 2, top + 1], phase: GAIT[2] },
    { x: hind + w + lean, y: top + lean, w, h: len - lean, rx,
      pivot: [hind + w + lean + w / 2, top + lean + 1], phase: GAIT[3] },
  ];
}

// Everything a species needs that is not simply written down: the flat
// resting composition the cursor and the menu use, in its two colours.
function assemble(spec) {
  const legs = spec.legs.map(legRect).join('');
  const pale = [
    spec.legsDark ? '' : legs,
    spec.tail.dark ? '' : spec.tail.markup,
    spec.ear.dark || spec.ear.over ? '' : spec.ear.markup,
    spec.head.dark ? '' : spec.head.markup,
    spec.ear.dark || !spec.ear.over ? '' : spec.ear.markup,
    spec.body.dark ? '' : spec.body.markup,
  ].join('');
  const dark = [
    spec.legsDark ? legs : '',
    spec.tail.dark ? spec.tail.markup : '',
    spec.ear.dark ? spec.ear.markup : '',
    spec.head.dark ? spec.head.markup : '',
    spec.body.dark ? spec.body.markup : '',
    spec.bodyMarks || '',
    spec.headMarks || '',
  ].join('');
  const ways = { ...DEFAULT_WAYS, ...(spec.ways || {}) };
  // An activity that says nothing about the tail gets the species' own.
  ways.acts = ways.acts.map((a) => ({ ...a, tail: a.tail || [ways.swish, ways.swishRate] }));
  return {
    ...spec,
    ways,
    legRects: legs,
    pale,
    dark,
    flat: pale + dark,
  };
}

// ---------------------------------------------------------------------
// The cow. The one the others were measured against, and the only one
// whose every number was argued over — see the notes above for why the
// neck is shaped the way it is.

const COW = {
  id: 'cow',
  label: 'Cow',
  hint: 'It wanders, stops to graze, and is not kept',
  box: { w: 64, h: 44 },
  ground: 36,
  size: 0.075,
  legs: legsFor({ fore: 28, hind: 45, top: 25, len: 11, w: 5, rx: 2.5, lean: 1 }),
  body: { markup: '<rect x="25" y="11" width="32" height="18" rx="9"/>' },
  headPivot: [30, 20],
  head: {
    markup:
      '<circle cx="30" cy="20" r="3.6"/>' +
      '<path d="M17 10.5c6 0 10.5 3 13.2 6.3v6.4c-4.7.8-9.7.3-13.2-.7z"/>' +
      // Horn nubs were tried twice and read as a third ear; a thin crescent
      // is a horn and cannot be read as anything else, at any size.
      '<path d="M11.6 9.5c-2.3-2-2.6-5.3-.6-7.2.7 1-.3 1.9-.5 3-.2 1.6.7 2.6 2.1 3.3z"/>' +
      '<path d="M15.9 9.1c-1.9-1.7-2.3-4.4-.6-6.2.6.9-.2 1.6-.3 2.6-.2 1.2.6 2.3 1.7 2.7z"/>' +
      '<rect x="4" y="8.5" width="19" height="17" rx="7.5"/>' +
      '<ellipse cx="7.8" cy="21" rx="5.4" ry="4.6"/>',
  },
  ear: {
    markup: '<path d="M16.6 13.9c1.2-5 5.8-8 8.2-6.2s-.4 6.2-4.2 8.2z"/>',
    pivot: [17.8, 14.7],
  },
  tail: {
    markup:
      '<path d="M54.4 12.4c4 .8 5.7 4.2 5.2 8.2l-.7 5.3-2.5-.3.7-5.3c.3-2.5-.8-4.1-3.1-4.4z"/>' +
      '<ellipse cx="58.2" cy="27.6" rx="2.7" ry="3.3"/>',
    pivot: [54.6, 13.2],
  },
  bodyMarks:
    '<ellipse cx="35" cy="16" rx="5.4" ry="3.9"/>' +
    '<ellipse cx="47" cy="23" rx="4.8" ry="3.5"/>',
  headMarks: '<circle cx="13.8" cy="16.5" r="2.4"/><ellipse cx="5.2" cy="22.1" rx="1.3" ry="1"/>',
  shadow: { at: 10, rx: 14.5 },
  // The cow is the default in every particular: see DEFAULT_WAYS.
  // Head face on, horns up, ears out: the one view of a cow that survives
  // being eighteen pixels wide.
  glyph:
    '<path d="M7 6.6C4.9 4 5.4 1.4 7.7.6c-.9 1.6-.7 3.5.8 5.4z"/>' +
    '<path d="M17 6.6C19.1 4 18.6 1.4 16.3.6c.9 1.6.7 3.5-.8 5.4z"/>' +
    '<ellipse cx="3.4" cy="10.8" rx="3.3" ry="2.1"/>' +
    '<ellipse cx="20.6" cy="10.8" rx="3.3" ry="2.1"/>' +
    '<path d="M12 5.2c3.8 0 5.6 1.5 5.6 3.7v3.4c0 3.4-2.5 6-5.6 6s-5.6-2.6-5.6-6V8.9c0-2.2 1.8-3.7 5.6-3.7z"/>',
};

// ---------------------------------------------------------------------
// The dog. Longer in the leg and lighter in the barrel, with a muzzle out
// front instead of under the head, one ear hanging, and a tail that is up
// rather than down — the one animal here whose tail says something.

const DOG = {
  id: 'dog',
  label: 'Dog',
  hint: 'It trots about, stops to sniff, and is not kept',
  box: { w: 64, h: 44 },
  ground: 36,
  size: 0.066,
  legs: legsFor({ fore: 27, hind: 45, top: 23, len: 13, w: 4.2, rx: 2.1, lean: 1 }),
  body: { markup: '<rect x="24" y="12" width="32" height="15" rx="7.5"/>' },
  headPivot: [29, 19],
  head: {
    markup:
      '<circle cx="29" cy="19" r="3.4"/>' +
      '<path d="M16 10c5.6 0 9.8 2.8 12.4 5.9v6c-4.4.8-9 .3-12.4-.7z"/>' +
      '<rect x="5" y="9" width="17" height="14" rx="6.5"/>' +
      // The snout goes out in front, not down: that and the leg length are
      // most of what makes this a dog and not a small cow.
      '<rect x="0.8" y="15" width="10" height="7.4" rx="3.5"/>',
  },
  ear: {
    // Hanging, and drawn over the head rather than behind it, because a
    // dropped ear lies on the side of the face.
    markup: '<path d="M16.4 11.2c3.4-.8 6 1.4 6 5s-2.4 6.4-4.8 5.8c1-2 1.4-3.6 1.2-5.6s-1.2-3.6-2.4-5.2z"/>',
    pivot: [17.2, 12],
    over: true,
  },
  tail: {
    markup:
      '<path d="M53.8 14.2c1-4 4.4-6.2 7.2-4.6l-1.2 2.4c-1.4-.7-3.2.5-3.6 2.8z"/>' +
      '<ellipse cx="60.4" cy="10.4" rx="2.2" ry="2.6"/>',
    pivot: [54, 14.8],
  },
  bodyMarks: '<ellipse cx="46" cy="18" rx="5" ry="3.6"/>',
  headMarks: '<circle cx="14.6" cy="15" r="2.2"/><ellipse cx="2.6" cy="17.6" rx="1.7" ry="1.4"/>',
  // Twice a cow's pace in short bursts, and never still for long. A trot
  // rather than a plod — `duty` at a half means the legs are off the
  // ground as much as on it — and a tail that does not stop, because that
  // is the whole of a dog.
  ways: {
    speed: 0.00007,
    ease: 180,
    turn: 150,
    beat: 3.4,
    swing: 22,
    duty: 0.5,
    bob: 1.4,
    nod: 180,
    drift: 0.9,
    swish: 26,
    swishRate: 0.011,
    earEvery: [1400, 4000],
    earBack: 34,
    // A wag, not a swat: often, and nothing like as far.
    swatEvery: [2200, 6000],
    swatHeld: 380,
    swatArc: -55,
    // It does not graze. It puts its nose down at something, briefly and
    // hard; or it sits, which is the one posture here that needed the
    // rear to be able to drop; or it stands with its head up and its ears
    // forward at something it has heard; or it shakes itself.
    acts: [
      act('sniff', { weight: 3, span: [900, 2200], head: 30, wag: [3.4, 0.021] }),
      act('sit', { weight: 2, span: [1800, 4500], head: -16, tilt: 15, tail: [30, 0.014] }),
      act('alert', { weight: 2, span: [700, 1800], head: -20, tail: [10, 0.006] }),
      act('shake', { weight: 1, span: [500, 1000], head: 2, wag: [7, 0.06], tail: [24, 0.02] }),
      act('trot', { weight: 4, span: [900, 2400], walks: true, tail: [22, 0.012] }),
    ],
  },
  shadow: { at: 9, rx: 14 },
  // Head face on: one ear up, one ear folded, which is the friendliest
  // thing a dog silhouette can do at this size.
  glyph:
    '<path d="M4.6 4.2c2.2-.6 4 .6 4.6 2.6L5 9.4C3.4 8 3 5.6 4.6 4.2z"/>' +
    '<path d="M19.4 4.2c-2.2-.6-4 .6-4.6 2.6L19 9.4c1.6-1.4 2-3.8.4-5.2z"/>' +
    '<path d="M12 5.6c3.6 0 5.8 1.6 5.8 4.2v2.6c0 3-1.6 4.6-2.8 5.6-.9.8-1.2 3-3 3s-2.1-2.2-3-3c-1.2-1-2.8-2.6-2.8-5.6V9.8c0-2.6 2.2-4.2 5.8-4.2z"/>' +
    '<ellipse cx="12" cy="17.4" rx="3" ry="2.4"/>',
};

// ---------------------------------------------------------------------
// The cat. Small, low and light, with a tail carried straight up — which
// is the whole silhouette, really, and the reason it is drawn as a long
// thin shape rather than the thick one every other tail here has.

const CAT = {
  id: 'cat',
  label: 'Cat',
  hint: 'It slinks about, sits down, and is not kept',
  box: { w: 64, h: 44 },
  ground: 36,
  size: 0.055,
  legs: legsFor({ fore: 28, hind: 44, top: 26, len: 10, w: 3.8, rx: 1.9, lean: 0.9 }),
  body: { markup: '<rect x="25" y="16" width="30" height="12" rx="6"/>' },
  headPivot: [30, 22],
  head: {
    markup:
      '<circle cx="30" cy="22" r="3" />' +
      '<path d="M19 15c5 0 8.8 2.4 11.2 5.2v4.8c-4 .7-8.2.2-11.2-.6z"/>' +
      // Two pointed ears, and they are the cat. Nothing else in this list
      // has a corner anywhere on it.
      '<path d="M11.4 15.2 9.6 6.8l6.4 4.6z"/>' +
      '<rect x="8" y="12" width="15" height="12.6" rx="6"/>',
  },
  ear: {
    markup: '<path d="M18.6 15.6 21.4 8l3.4 6.6z"/>',
    pivot: [20, 15.2],
  },
  tail: {
    markup: '<path d="M52 17.6c3.6-2.6 7.4-1 8.2 3.2l1 5.2-2.6.5-1-5.2c-.5-2.4-2.4-3.3-4.2-2z"/>',
    pivot: [52.6, 18.4],
  },
  bodyMarks:
    '<rect x="36" y="16.4" width="2.6" height="5" rx="1.3"/>' +
    '<rect x="41" y="16.4" width="2.6" height="5.6" rx="1.3"/>' +
    '<rect x="46" y="16.6" width="2.6" height="5.2" rx="1.3"/>',
  headMarks: '<circle cx="13.6" cy="17.4" r="2.1"/><ellipse cx="9.4" cy="20.6" rx="1.3" ry="1"/>',
  // Sits for a very long time and then goes somewhere, unhurried about
  // all of it. The back stays level — a cat does not bob — and the tail is
  // slow, high and lazy where the dog's is frantic. Its ears do more than
  // any other animal's here.
  ways: {
    speed: 0.000045,
    ease: 260,
    turn: 320,
    beat: 2.6,
    swing: 17,
    duty: 0.58,
    bob: 0.7,
    nod: 420,
    drift: 0.5,
    swish: 20,
    swishRate: 0.0016,
    earEvery: [2200, 6000],
    earBack: 40,
    swatEvery: [5000, 13000],
    swatHeld: 900,
    swatArc: -120,
    // Sits, mostly, and washes. Nothing here puts its head to the floor to
    // eat: sitting holds the head *up*, which the neck takes without
    // complaint because its cap is centred on the pivot and is therefore
    // as covered at a negative angle as at a positive one. Stalking is a
    // walk done low, which is the same walk with the body dropped.
    acts: [
      act('sit', { weight: 4, span: [3000, 9000], head: -14, tail: [16, 0.0014] }),
      act('wash', { weight: 2, span: [1400, 3200], head: 34, wag: [5.5, 0.022] }),
      act('crouch', { weight: 1, span: [900, 1800], head: 6, sink: 1.6, tail: [8, 0.004] }),
      act('stalk', { weight: 2, span: [1000, 2600], walks: true, head: 8, sink: 1.3, tail: [10, 0.003] }),
      act('prowl', { weight: 1, span: [800, 2000], walks: true }),
    ],
  },
  shadow: { at: 8, rx: 13 },
  // Ears and whiskers. A cat's head is a triangle with two more on top.
  glyph:
    '<path d="M6.4 8.6 4.2 1.8l6 4.2z"/>' +
    '<path d="M17.6 8.6 19.8 1.8l-6 4.2z"/>' +
    '<path d="M12 5.4c4 0 6.6 2.2 6.6 5.4 0 4.4-3 8-6.6 8s-6.6-3.6-6.6-8c0-3.2 2.6-5.4 6.6-5.4z"/>' +
    '<rect x="0.6" y="12.4" width="5.4" height="1.5" rx="0.75"/>' +
    '<rect x="18" y="12.4" width="5.4" height="1.5" rx="0.75"/>',
};

// ---------------------------------------------------------------------
// The pig. All barrel and no leg, with the snout carried high and a tail
// that is one curl. The only one whose head does not really go down,
// because there is nowhere for it to go.

const PIG = {
  id: 'pig',
  label: 'Pig',
  hint: 'It roots about, stands still, and is not kept',
  box: { w: 64, h: 44 },
  ground: 36,
  size: 0.07,
  legs: legsFor({ fore: 27, hind: 45, top: 27, len: 9, w: 4.6, rx: 2.3, lean: 0.9 }),
  body: { markup: '<rect x="22" y="12" width="34" height="18" rx="9"/>' },
  headPivot: [28, 21],
  head: {
    markup:
      '<circle cx="28" cy="21" r="3.6"/>' +
      '<path d="M15 13c5.6 0 10 2.6 12.4 5.6v6c-4.4.8-9.2.3-12.4-.7z"/>' +
      '<rect x="4" y="11" width="17" height="14.5" rx="6.5"/>' +
      // The disc on the front. A pig is its snout and nothing else.
      '<ellipse cx="4.6" cy="19.8" rx="4.4" ry="4"/>',
  },
  ear: {
    // Forward and flopping, over the brow.
    markup: '<path d="M14.6 12.6c2.6-2.6 5.8-2.2 6.4.6.5 2.4-1.6 4.2-4.4 4z"/>',
    pivot: [15.4, 13.4],
    over: true,
  },
  tail: {
    // One curl, and it is the only tail here that is a loop.
    markup:
      '<path d="M54.8 14.4c3.6-.6 5.6 1.4 5.2 4-.3 2-2 3.2-3.6 2.6-1.2-.5-1.5-2-.4-2.5.5.9 1.4.5 1.5-.4.2-1-.7-1.8-2.2-1.5z"/>',
    pivot: [55, 15.2],
  },
  bodyMarks: '<ellipse cx="44" cy="18" rx="5.6" ry="4"/>',
  headMarks:
    '<circle cx="12.4" cy="17" r="2.1"/>' +
    '<ellipse cx="3.4" cy="18.6" rx="0.9" ry="1.2"/>' +
    '<ellipse cx="3.4" cy="21.4" rx="0.9" ry="1.2"/>',
  // Short legs mean quick little steps: the highest beat here and the
  // smallest swing, which together are a trundle. It roots more than it
  // walks, turns like a barge, and has a tail with almost nothing to
  // swing — so what it does instead is twitch it, often.
  ways: {
    speed: 0.000034,
    ease: 300,
    turn: 330,
    beat: 3.6,
    swing: 12,
    duty: 0.7,
    bob: 1.1,
    nod: 260,
    drift: 0.45,
    swish: 22,
    swishRate: 0.008,
    earEvery: [2600, 7000],
    earBack: 22,
    swatEvery: [3000, 8000],
    swatHeld: 260,
    swatArc: -40,
    // Rooting, which is not grazing: the head goes down a short way — the
    // snout is nearly at the floor to begin with — and then works, hard
    // and fast. It is the widest, quickest head movement of the five.
    acts: [
      act('root', { weight: 4, span: [2600, 7000], head: 24, wag: [4.2, 0.028] }),
      act('stand', { weight: 2, span: [1400, 3000], head: 2, ear: 0.2 }),
      act('trundle', { weight: 3, span: [700, 1900], walks: true }),
    ],
  },
  shadow: { at: 9, rx: 14.5 },
  // Snout on, which is the only view where a pig is unmistakable: a disc
  // with two nostrils and two folded ears above it.
  glyph:
    '<path d="M5.4 7.4C4 4.6 5 2.2 7.6 2c-.7 1.4-.5 3 .8 4.4z"/>' +
    '<path d="M18.6 7.4C20 4.6 19 2.2 16.4 2c.7 1.4.5 3-.8 4.4z"/>' +
    '<path d="M12 5.6c4.2 0 6.8 2 6.8 5v3c0 3.4-3 6-6.8 6s-6.8-2.6-6.8-6v-3c0-3 2.6-5 6.8-5z"/>',
};

// ---------------------------------------------------------------------
// The sheep. A cloud on four dark sticks, with a dark face — which is the
// whole trick, and the reason this file lets a species say which of its
// parts are drawn dark rather than pale.

const SHEEP = {
  id: 'sheep',
  label: 'Sheep',
  hint: 'It drifts about, stops to crop the grass, and is not kept',
  box: { w: 64, h: 44 },
  ground: 36,
  size: 0.07,
  legs: legsFor({ fore: 29, hind: 45, top: 24, len: 12, w: 3.4, rx: 1.7, lean: 0.9 }),
  legsDark: true,
  body: {
    // Scalloped, because a sheep read as a rounded rectangle is a small
    // pale pig. The bumps are the fleece and they are the whole animal.
    markup:
      '<path d="M28 10c1.6-2.4 4.6-2.6 6.4-.8 1.4-2.4 4.6-2.6 6.4-.6 1.6-2.2 4.8-2 6.2.4 2.6-1 5.4.8 5.6 3.6 2.8.4 4.4 3 3.4 5.6 2 1.8 1.6 5-.8 6.4.4 2.8-2 5-4.8 4.4-1 2.6-4.2 3.4-6.4 1.8-1.8 2.2-5 2-6.6-.4-2.4 1.4-5.4.2-6.2-2.4-2.8.6-5.4-1.4-5.4-4.2-2.6-.8-3.6-3.8-2-6 -1.6-2.2-.8-5.2 1.8-6.2-.4-2.8 1.8-5 4.4-4.6z"/>',
  },
  headPivot: [29, 21],
  head: {
    dark: true,
    markup:
      '<circle cx="29" cy="21" r="3.4"/>' +
      '<path d="M17 14c5.4 0 9.6 2.6 12 5.6v5.8c-4.2.8-8.8.3-12-.7z"/>' +
      '<rect x="5" y="12.5" width="16" height="13.5" rx="6.4"/>' +
      '<ellipse cx="6.4" cy="22.4" rx="4" ry="3.4"/>',
  },
  ear: {
    dark: true,
    markup: '<path d="M15.4 15c3-1.6 5.8-.6 6 1.8s-2.6 3.8-5.6 3z"/>',
    pivot: [16.2, 15.8],
  },
  tail: {
    markup: '<ellipse cx="55.6" cy="16.6" rx="3.4" ry="3.8"/>',
    pivot: [54.4, 15.6],
  },
  bodyMarks: '',
  // A pale eye, because the face it sits in is dark. The only mark in this
  // file that is not drawn in the dark colour, so it carries its own.
  headMarks: '',
  headLight: '<circle cx="12.6" cy="18.4" r="2"/>',
  // The slowest of the five, and the one with its head down the longest:
  // a few steps, then four seconds of grass. Ears that go back often,
  // because a sheep is a nervous animal, and a tail too small to do much
  // with.
  ways: {
    speed: 0.000026,
    ease: 400,
    turn: 380,
    beat: 2.8,
    swing: 13,
    duty: 0.66,
    bob: 0.6,
    nod: 300,
    drift: 0.35,
    swish: 10,
    swishRate: 0.004,
    earEvery: [1800, 5200],
    earBack: 26,
    swatEvery: [6000, 15000],
    swatHeld: 300,
    swatArc: -35,
    // Cropping grass, which is grazing done in small quick bites rather
    // than the cow's slow pull — and then standing bolt upright with its
    // ears back, having heard something, which is the other half of being
    // a sheep.
    acts: [
      act('crop', { weight: 5, span: [4000, 11000], head: 30, wag: [1.2, 0.015] }),
      act('stare', { weight: 2, span: [1000, 2400], head: -10, ear: 0.5 }),
      act('drift', { weight: 2, span: [800, 2200], walks: true }),
    ],
  },
  shadow: { at: 9, rx: 14 },
  // Fleece over a dark face, which is a sheep at any size at all.
  glyph:
    '<path d="M12 2.4c2.4 0 4 1.2 4.6 2.8 2.4-.2 4.2 1.6 4 4 1.8 1 2.2 3.6.6 5.2.6 2.2-1.2 4.2-3.6 4-.8 1.8-3 2.6-4.8 1.6-1.8 1-4 .2-4.8-1.6-2.4.2-4.2-1.8-3.6-4-1.6-1.6-1.2-4.2.6-5.2-.2-2.4 1.6-4.2 4-4C8 3.6 9.6 2.4 12 2.4z"/>',
};

export const ANIMALS = [COW, DOG, CAT, PIG, SHEEP].map(assemble);
export const ANIMAL_BY_ID = Object.fromEntries(ANIMALS.map((a) => [a.id, a]));
export const animalFor = (id) => ANIMAL_BY_ID[id] || ANIMAL_BY_ID.cow;
