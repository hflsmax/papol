import { RIGS } from './beasts';

// The animals a reader can put on a page.
//
// All three are the same beast underneath: a barrel, a neck, a head, four
// legs and a tail, each in the group it turns in. What differs between a
// cow and a cat is proportion and a handful of shapes — which is the whole
// reason they are records in a list rather than three drawings. One engine
// walks all of them (see cow.js), and adding a sixth is a matter of
// writing down where its legs are.
//
// The rules the cow was got right under, which the rest inherit:
//
//  - Everything that can be a capsule is one: the barrel, the neck, the
//    head, every leg. Shapes drawn the same way read as animals
//    of one family, and a rounded rectangle with its corners at half its
//    height is the roundest, plainest shape there is. What is left over —
//    a snout, an ear, a horn, a tail — is one shape each, and no part of
//    any animal here is two curves where it could be one.
//  - The head is drawn under the barrel, and it turns. Anything that turns
//    sweeps, so a shape tucked under the body at rest comes out from under
//    it at twenty degrees. The neck is therefore a capsule laid along the
//    animal with its far end centred on the head's pivot: the round end of
//    the neck *is* the cap over the joint, because a circle centred on the
//    point it turns about does not move when it turns. That is one shape
//    doing the work of two, and it is why every neck below is a `rect`
//    whose right edge runs half its own height past the pivot.
//  - The pivot sits roughly level with the muzzle and a long way behind
//    it, so that turning carries the muzzle down to the grass rather than
//    backwards into the animal's own chest.
//  - One eye, and nothing on the body but the cow's two spots. Markings
//    were the first thing tried for telling them apart and the worst:
//    what tells a cat from a dog across a page is the shape of the whole
//    animal, and a flank full of detail only makes it later to read.
//  - Nothing sets its own fill. The parent decides, because the page wants
//    a pale animal with a dark outline and dark markings, and the button
//    wants one flat colour.

// One thing an animal does, with everything it does not care about left
// out. `head` is degrees — positive down to the floor, negative up to look
// at something — and `wag` is the working it does while it is there: a
// size and a rate. A cow nuzzling, a dog snuffling and a cat washing are
// all this one oscillation at three very different sizes, and that is
// most of what tells them apart.
//
// `tilt` drops the rear (a dog sitting) and `sink` lowers the whole body
// (a cat crouching, a cat loafing until it has no feet). Both only ever
// bring the body nearer its own feet, which is what makes them safe: the
// legs are drawn under the body, so a body that comes down covers more of
// them and never less.
//
// `paw` is the one thing that takes a foot off the ground while the animal
// is standing still — `[leg, degrees, wobble, rate]`, where the leg is an
// index into `legs` and a positive angle carries the foot forward, the way
// the gait's own positive angle does. It is what a cat washing and a dog
// scratching have and nothing else does, and it is most of why those two
// no longer look like animals grazing.
//
// A foot carried far enough forward ends up under the barrel, and the
// barrel is drawn over the legs — which is why a dog scratching used to be
// a dog standing still and shivering, with the leg doing the work hidden
// behind its own body. See `pawOver` for the way out of that.
//
// `nod` overrides how long the body takes to settle into the activity, for
// the one or two that are not settling into anything: a dog that hears
// something does not ease its head up over a third of a second.
const act = (id, o) => ({
  id,
  weight: 1,
  span: [1400, 3600],
  head: 0,
  wag: [0, 0],
  ear: 0,
  tilt: 0,
  sink: 0,
  paw: null,
  nod: 0,
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
  // The angle past which a raised foot is drawn on our side of the body
  // rather than behind it, or null for a species that never needs it. A
  // near leg swung up under the belly is in front of the barrel in life,
  // and behind it in this drawing, so at some point in the swing the two
  // have to part company. Set it where the leg is on its way out of sight
  // — the swap then adds the top of a leg to a picture that already has
  // the bottom of it, while the whole thing is moving fast, which is the
  // cheapest moment there is to change your mind about z-order.
  pawOver: null,
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

// The neck: a capsule from somewhere inside the head to half its own
// height past the pivot, so that its round end is exactly the circle the
// joint turns inside. See the rules at the top of the file — this is the
// one measurement in an animal that is not free.
const neck = (from, [px, py], h) =>
  `<rect x="${from}" y="${py - h / 2}" width="${px + h / 2 - from}" height="${h}" rx="${h / 2}"/>`;

// The pen.
//
// One line width, and "the same width" means the same number of pixels
// where the reader is looking. That sounds like one number and is not,
// because an animal is drawn in three places at three different scales:
// on the page at its own size, in the hand as a cursor at that same size,
// and in the menu where they all share one cell. A single stroke written
// in box units comes out at three different weights in those three
// places, and picking whichever one of them to be right about is what
// made this wrong three times over.
//
// So there is no stroke here. There is a width the page is to be inked at
// — `PEN`, which is what the cow was tuned at — and each drawing site
// derives what it has to ask for to land on it. The two below cover the
// two that are scaled by something knowable; the cursor works its own out
// from the size it is about to be, because it clamps.
const PEN = 1.5;
const PEN_AT = { size: 0.075, w: 64, rx: 14.5 };

// For an animal drawn at its own size on the page. A species drawn small
// needs a wider stroke in its own box to arrive at the same line.
const penFor = (spec) => (PEN * PEN_AT.size * spec.box.w) / (spec.size * PEN_AT.w);

// How much to scale a species by to draw it at the size the family is
// drawn at. The menu is the one place they all appear together, and it
// gives each of them the same cell — but a cat fills forty-six units of
// its sixty-four-wide box where a cow fills fifty-four, so the cat came
// out smaller than the cow in a box the same size. `shadow.rx` is the
// half-width of what the animal stands on, which is the one measurement
// of how big it is drawn that every species already carries.
const fitFor = (spec) => PEN_AT.rx / spec.shadow.rx;

// And the pen to use inside a group that has been scaled by `fit`: the
// scale multiplies the stroke along with everything else, so the stroke
// has to be divided by it going in. `fitStroke * fit` is `PEN` for every
// species, which is the whole point — same size in the sheet, and the
// same number of pixels of ink round it.
const fitPenFor = (spec) => PEN / fitFor(spec);

// Everything a species needs that is not simply written down: the flat
// resting composition the cursor and the menu use, in its two colours.
function assemble(spec) {
  // A rigged species has no capsules to compose: its still picture is its
  // own rest pose, painted by the rig, and the parent supplies only the
  // pen. See `restMarkup`.
  if (spec.rig) {
    const ways = { ...DEFAULT_WAYS, ...(spec.ways || {}) };
    ways.acts = ways.acts.map((a) => ({ ...a, tail: a.tail || [ways.swish, ways.swishRate] }));
    // How often it puts a foot down, which is not a thing anybody gets to
    // choose. It is how fast the animal is going divided by how far one
    // stride carries it, and both of those are already written down — the
    // speed here, the stride in the rig. It used to be a sixth number,
    // written by hand next to the speed, and it disagreed with it in
    // every case: the cat was covering four times as much ground
    // as its feet were, which is not a cat walking, it is a cat on a
    // trolley. See `carry` in beast.js.
    //
    // `speed` is page-fractions a millisecond and the rig thinks in its
    // own box, so the conversion is how much of a page one box unit is.
    const unitsASecond = (ways.speed * 1000 * spec.box.w) / spec.size;
    ways.beat = unitsASecond / spec.rig.carry;
    return {
      ...spec,
      stroke: penFor(spec),
      fit: fitFor(spec),
      fitStroke: fitPenFor(spec),
      ways,
      overLegs: [],
      painted: spec.rig.rest(),
      pale: '',
      dark: '',
      flat: '',
    };
  }
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
  // The legs that ever come up far enough to want drawing in front of the
  // body, worked out from the activities rather than written down twice.
  // A species with no `pawOver` has none, and pays for none.
  const overLegs = ways.pawOver == null
    ? []
    : [...new Set(ways.acts.filter((a) => a.paw).map((a) => a.paw[0]))].sort();
  return {
    ...spec,
    stroke: penFor(spec),
    fit: fitFor(spec),
    fitStroke: fitPenFor(spec),
    ways,
    overLegs,
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
  legs: legsFor({ fore: 30, hind: 45, top: 26, len: 10, w: 5, rx: 2.5, lean: 1 }),
  body: { markup: '<rect x="26" y="11" width="29" height="18" rx="9"/>' },
  headPivot: [30, 20],
  head: {
    markup:
      neck(19, [30, 20], 11) +
      // Two nubs rather than the pair of crescents this had before. A
      // crescent is three curves and a calf's horn is a bump, and at the
      // size an animal is drawn on a page the bump is the one that reads.
      // Canted well out, which is the whole of what keeps them horns
      // rather than a third and fourth ear.
      '<ellipse cx="12.2" cy="5.8" rx="2.1" ry="2.9" transform="rotate(-34 12.2 5.8)"/>' +
      '<ellipse cx="18.8" cy="5.4" rx="2" ry="2.7" transform="rotate(28 18.8 5.4)"/>' +
      '<rect x="6.5" y="8" width="19" height="17.5" rx="8.75"/>' +
      '<ellipse cx="10" cy="20.6" rx="5" ry="4.4"/>',
  },
  ear: {
    // High on the back of the head, because with the head carried this
    // close to the shoulder an ear behind it is an ear behind the barrel,
    // and the barrel is drawn last.
    markup: '<ellipse cx="22.8" cy="8.8" rx="4.6" ry="3" transform="rotate(-38 22.8 8.8)"/>',
    pivot: [20.4, 10.8],
  },
  tail: {
    // Hung off the flank rather than curled round it: a straight rope and
    // a round tuft, which is a cow's tail with nothing else in it. Short,
    // because a tuft that hangs level with the feet is a fifth leg.
    markup:
      '<rect x="54.6" y="16" width="3" height="11" rx="1.5"/>' +
      '<ellipse cx="56.1" cy="28" rx="3" ry="3.4"/>',
    pivot: [56.1, 17],
  },
  bodyMarks:
    '<ellipse cx="34" cy="16.5" rx="5" ry="4"/>' +
    '<ellipse cx="46.5" cy="23.5" rx="4.4" ry="3.4"/>',
  headMarks: '<circle cx="17" cy="16" r="2.8"/>',
  shadow: { at: 9, rx: 14.5 },
  // Drawn on the bone rig rather than out of capsules: one outline bound
  // to a spine that bends, legs solved to the ground, and every joint on
  // a spring of its own. See beasts.js for the three, beast.js for the
  // machinery.
  //
  // The capsules above are still here and still describe the animal — the
  // shadow, the size and the ways are read off this record whatever it is
  // drawn out of. A species with a `rig` uses it everywhere it is drawn,
  // page and cursor and menu alike; one without goes on exactly as
  // before, which is what let this be done one animal at a time.
  rig: RIGS.cow,
  // The cow is the default in every particular: see DEFAULT_WAYS.
  // Head face on, horns up, ears out: the one view of a cow that survives
  // being eighteen pixels wide.
  //
  // The horns used to be thin sickles floating clear of the skull, with a
  // gap between horn and head at this size a stroke wide — so nothing
  // told them from a pair of antennae, and the whole glyph read as a bug.
  // Short, blunt, and lapped onto the skull instead: a horn a tenth the
  // old one's length, fused into the head rather than perched above it.
  glyph:
    '<path d="M8.2 4.2c-.4-1.4.1-2.6 1.5-3.4-.6 1.2-.6 2.3.1 3.4z"/>' +
    '<path d="M15.8 4.2c.4-1.4-.1-2.6-1.5-3.4.6 1.2.6 2.3-.1 3.4z"/>' +
    '<ellipse cx="3.5" cy="11.6" rx="3.1" ry="2.2"/>' +
    '<ellipse cx="20.5" cy="11.6" rx="3.1" ry="2.2"/>' +
    '<path d="M12 4.6c3.9 0 6 1.7 6 4.2v3.1c0 3.6-2.6 6.5-6 6.5s-6-2.9-6-6.5V8.8c0-2.5 2.1-4.2 6-4.2z"/>',
};

// ---------------------------------------------------------------------
// The dog. A muzzle out front instead of under the head, one ear hanging
// past the jaw, and a tail that is up rather than down — the one animal
// here whose tail says something. Everything else about it is a cow's
// shapes at a puppy's proportions.

const DOG = {
  id: 'dog',
  label: 'Dog',
  hint: 'It trots about, stops to sniff, and is not kept',
  box: { w: 64, h: 44 },
  ground: 36,
  size: 0.066,
  legs: legsFor({ fore: 29, hind: 45, top: 27, len: 9, w: 4.6, rx: 2.3, lean: 0.9 }),
  body: { markup: '<rect x="25" y="13" width="30" height="17" rx="8.5"/>' },
  headPivot: [29, 21.5],
  head: {
    markup:
      neck(18.5, [29, 21.5], 10) +
      '<rect x="7" y="10" width="18" height="16" rx="8"/>' +
      // The snout goes out in front, not down: that and the drop of the
      // ear are most of what makes this a dog and not a small cow.
      '<rect x="4" y="17" width="8.6" height="7.4" rx="3.7"/>',
  },
  ear: {
    // Hanging, and drawn over the head rather than behind it, because a
    // dropped ear lies on the side of the face. Long enough to hang past
    // the jaw, which is the whole of what makes it read as an ear: one
    // drawn wholly inside the head reads as a hole cut in it.
    markup: '<ellipse cx="21.2" cy="19.4" rx="3.8" ry="8" transform="rotate(10 21.2 19.4)"/>',
    pivot: [19.8, 11.8],
    over: true,
  },
  tail: {
    // Up and stiff, which is the one thing a dog's tail says at rest.
    markup: '<rect x="48" y="12.2" width="9.5" height="4.4" rx="2.2" transform="rotate(-48 49 14.4)"/>',
    pivot: [49, 14.4],
  },
  bodyMarks: '',
  headMarks: '<circle cx="13.6" cy="16" r="2.6"/><ellipse cx="5.8" cy="19.6" rx="1.8" ry="1.5"/>',
  // Half again a cow's pace in short bursts, and never still for long. A
  // trot rather than a plod — `duty` at a half means the legs are off the
  // ground as much as on it — and a tail that does not stop, because that
  // is the whole of a dog.
  //
  // It was twice the cow's, and on a page that is not a dog, it is a dog
  // being chased: an animal a fifth of the page long crossing the whole of
  // it in a dozen seconds reads as fleeing rather than as pottering about.
  // `beat` came down with it — strides a second at walking pace, so it has
  // to fall with the speed or the feet are running under an animal that is
  // no longer keeping up with them.
  ways: {
    speed: 0.000037,
    ease: 220,
    turn: 180,
    beat: 2.5,
    swing: 22,
    duty: 0.5,
    bob: 1.4,
    nod: 180,
    drift: 0.7,
    swish: 26,
    swishRate: 0.011,
    earEvery: [1400, 4000],
    earBack: 34,
    // A wag, not a swat: often, and nothing like as far.
    swatEvery: [2200, 6000],
    swatHeld: 380,
    swatArc: -55,
    // The hind foot goes up under the belly to get at the ear, and from
    // there on it is drawn in front of the barrel. See `pawOver`.
    pawOver: 46,
    // The dog's own, and not one of them is a head held down at the
    // ground for eight seconds. It sits and works at its ear with a hind
    // foot; it sits and wags; it hears something and stands up into it,
    // ears forward; it puts its nose down at a spot, briefly and hard,
    // and is done with it; it shakes itself out.
    acts: [
      // The scratch, which is the one activity here that needed the leg
      // doing the work to be visible. The foot comes right up under the
      // belly — 104 degrees, where a walk's is twenty — the rear drops
      // onto the other hip, the head goes down and over towards the foot,
      // and the whole dog jerks with it: `wag` is at the paw's own rate,
      // so the head and the leg are one movement rather than two.
      //
      // The thump was at fourteen a second, which is faster than a screen
      // can show and read as a shiver with no shape to it; six is a dog.
      act('scratch', {
        weight: 3, span: [1300, 2800], head: 20, tilt: 12, ear: 0.55,
        paw: [2, 104, 16, 0.036], wag: [4, 0.036], tail: [10, 0.006], nod: 110,
      }),
      act('sit', { weight: 3, span: [1800, 4500], head: -16, tilt: 15, tail: [34, 0.021] }),
      act('alert', { weight: 2, span: [700, 1800], head: -20, ear: -0.6, tail: [10, 0.006], nod: 90 }),
      act('sniff', { weight: 2, span: [700, 1600], head: 30, wag: [3.4, 0.021] }),
      act('shake', { weight: 1, span: [500, 1000], head: 2, wag: [7, 0.06], tail: [24, 0.02], nod: 70 }),
      act('trot', { weight: 4, span: [900, 2400], walks: true, tail: [22, 0.012] }),
    ],
  },
  shadow: { at: 9, rx: 14 },
  // Head face on, and hanging off it the two ears that are the whole of
  // what a beagle is at eighteen pixels.
  //
  // They used to be up and folded, but drawn as flat fill with no line to
  // separate ear from skull, "folded" was invisible: the ear's own curve
  // ran tangent into the head's, and the two fused into one smooth outline
  // — a lump, not a dog. What a silhouette can show instead is a real gap:
  // each ear now leaves the skull at a point and swells out into open
  // space beside it rather than along it, so there is background between
  // ear and head for most of the ear's own length. That gap is the whole
  // of what makes it read as hung off the head rather than part of it.
  rig: RIGS.dog,
  glyph:
    '<path d="M17.6 7.8C22 7.4 24.4 11 23.6 14.8 23 17.8 20.4 19.8 17.6 19.2 19.6 15.7 19.8 11.6 17.6 7.8Z"/>' +
    '<path d="M6.4 7.8C2 7.4-.4 11 .4 14.8 1 17.8 3.6 19.8 6.4 19.2 4.4 15.7 4.2 11.6 6.4 7.8Z"/>' +
    '<path d="M12 5.6c3.6 0 5.8 1.6 5.8 4.2v2.6c0 3-1.6 4.6-2.8 5.6-.9.8-1.2 3-3 3s-2.1-2.2-3-3c-1.2-1-2.8-2.6-2.8-5.6V9.8c0-2.6 2.2-4.2 5.8-4.2z"/>' +
    '<ellipse cx="12" cy="17.4" rx="2.6" ry="2.1"/>',
};

// ---------------------------------------------------------------------
// The cat. Small and light, with two corners on its head and a tail
// carried straight up — which between them are the whole silhouette,
// really, and the only two shapes in the file that are not round.

const CAT = {
  id: 'cat',
  label: 'Cat',
  hint: 'It slinks about, sits down, and is not kept',
  box: { w: 64, h: 44 },
  ground: 36,
  size: 0.055,
  // A kitten, not a cat: everything that says young says it by proportion,
  // and the proportions are all the same one — the head is too big for the
  // body, the eye is too big for the head, the ears are too big for both,
  // and the legs are too short for any of it. The cat had a cat's
  // proportions and was the least cuddly thing on the page for it.
  legs: legsFor({ fore: 30, hind: 44, top: 29.4, len: 6.6, w: 4.4, rx: 2.2, lean: 0.9 }),
  body: { markup: '<rect x="28" y="15" width="26" height="16" rx="8"/>' },
  headPivot: [30, 22.5],
  head: {
    markup:
      neck(19, [30, 22.5], 10) +
      // Two pointed ears, and they are the cat. Nothing else in this list
      // has a corner anywhere on it — and they are drawn a size too big
      // for the head, because a kitten's are. Upright and close together,
      // where they used to splay: a pair of ears leaning away from each
      // other over a big round head is a bat, and the difference between
      // the two animals is about fifteen degrees.
      '<path d="M12.4 12.6 12.9 3.4l6.4 6z"/>' +
      '<rect x="8.4" y="9.2" width="20" height="18" rx="9"/>' +
      // A cheek. The cat was the one animal here with nothing at the front
      // of its face, and a head with an eye and no muzzle is a bean. Low
      // and small, which leaves the whole top half of the head to be
      // forehead — the other half of what makes a face young.
      '<ellipse cx="11.4" cy="22.8" rx="3.6" ry="3"/>',
  },
  ear: {
    markup: '<path d="M20.6 12.2 25.9 4.2l3.3 8.8z"/>',
    pivot: [22.8, 12.4],
  },
  tail: {
    // Straight up and then hooked over at the tip, towards the head. Up
    // is what a cat's tail says; the hook is what stops it being a stick,
    // and it is still one shape — a band drawn up one side, round the
    // tip and back down the other.
    markup: '<path d="M53.1 24V12A5.7 5.7 0 0 0 47.4 6.3A1.7 1.7 0 0 0 47.4 9.7A2.3 2.3 0 0 1 49.7 12V24z"/>',
    pivot: [51.4, 23],
  },
  bodyMarks: '',
  // One round eye, bigger than any other animal's here and low enough in
  // the head to leave a forehead over it, which is the whole of what makes
  // a face young. Nothing in it: every animal in this file has a flat dark
  // eye, and a cat that alone had a glint in its would be a cat from a
  // different drawing.
  headMarks: '<circle cx="16.8" cy="19" r="3.5"/>',
  // Sits for a very long time and then goes somewhere, unhurried about
  // all of it. The back stays level — a cat does not bob — and the tail is
  // slow, high and lazy where the dog's is frantic. Its ears do more than
  // any other animal's here.
  ways: {
    // A cat crossing a page used to do it at half again a cow's speed,
    // which is a cat being carried past on a trolley: it is a third of
    // the animal, so the same page a second is three times the ground in
    // its own body-lengths. At this it walks about its own length a
    // second, which is a cat.
    speed: 0.00003,
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
    // Washing is the cat's: a front paw comes up off the ground and the
    // head comes down to meet it, which is a thing no other animal here
    // does with a foot. The loaf is the other one — down onto its own
    // feet until it has none, which the body may do because coming down
    // only ever covers more leg. Stalking is a walk done low.
    acts: [
      act('wash', {
        weight: 3, span: [1800, 4200], head: 22, wag: [4.5, 0.03],
        paw: [0, 54, 7, 0.032], tail: [8, 0.002],
      }),
      act('loaf', { weight: 3, span: [3200, 9000], head: -6, sink: 4, tail: [5, 0.0012] }),
      act('sit', { weight: 2, span: [2000, 6000], head: -14, tail: [16, 0.0014] }),
      act('stalk', { weight: 2, span: [1000, 2600], walks: true, head: 8, sink: 1.3, tail: [10, 0.003] }),
      act('prowl', { weight: 2, span: [800, 2000], walks: true }),
    ],
  },
  shadow: { at: 8, rx: 12.5 },
  // Ears and whiskers. A cat's head is a triangle with two more on top,
  // and they are a size too big for it, because a kitten's are.
  rig: RIGS.cat,
  glyph:
    '<path d="M6.4 8.6 4.4 2.6l5.8 3.8z"/>' +
    '<path d="M17.6 8.6 19.6 2.6l-5.8 3.8z"/>' +
    '<path d="M12 5.4c4 0 6.6 2.2 6.6 5.4 0 4.4-3 8-6.6 8s-6.6-3.6-6.6-8c0-3.2 2.6-5.4 6.6-5.4z"/>' +
    '<rect x="0.6" y="12.4" width="5.4" height="1.5" rx="0.75"/>' +
    '<rect x="18" y="12.4" width="5.4" height="1.5" rx="0.75"/>',
};

export const ANIMALS = [COW, DOG, CAT].map(assemble);
export const ANIMAL_BY_ID = Object.fromEntries(ANIMALS.map((a) => [a.id, a]));
export const animalFor = (id) => ANIMAL_BY_ID[id] || ANIMAL_BY_ID.cow;
