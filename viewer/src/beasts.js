// The three, on the bone rig.
//
// Each is a skeleton, one line round itself, four legs and a few loose
// pieces. What differs between a cow and a cat is where those points are
// — which is the whole reason they are records in a list rather than
// three drawings. See beast.js for the machinery and for the rules.

import { makeRig, ring, far, PALE, DARK, OFF, TAN, CREAM, POINT, BLUE } from './beast';

export const BOX = { w: 64, h: 44 };
export const GROUND = 36;
const FAR = 34.4;

// How each of them puts its feet down.
//
// This was one array for all of them, which is a lot of character to throw
// away: the order the feet land in, how long each stays down and how high
// it comes up are most of what tells a plod from a trot across a page,
// and none of it costs anything.
//
// The four entries are in the order the legs are listed: far fore, far
// hind, near fore, near hind. `duty` is the fraction of a stride a foot
// spends on the ground — high is a plod, where a foot is planted and the
// body travels over it; low is a trot, where the legs are off the ground
// as much as on it. `lift` is how far a foot comes up on the way through.
// Every animal in this list is lateral: cattle, dogs and cats all put
// the fore down on the side the hind has just left. So the
// order round is near hind, near fore, far hind, far fore, a quarter of a
// stride apart — which written into the order the legs are listed is the
// numbers going *down*.
//
// This was [0.25, 0.5, 0.75, 0], and the note above it said it was
// lateral. It was not: reading the four out in the order they land gives
// near hind, far fore, far hind, near fore — a hind followed by the
// *opposite* fore, which is a diagonal-sequence walk and is what lemurs
// do. The array that was replaced was diagonal too, and swapping one pair
// for another moved which two feet were wrong without fixing any of them.
const WALK = [0.75, 0.5, 0.25, 0];
// A trot moves diagonal pairs together, and it is the whole of what makes
// a dog look busy next to a cow.
const TROT = [0, 0.5, 0.5, 0];
// And the cat's, which is a lateral walk with the couplets closed right
// up: the fore foot comes down almost on the heels of the hind on the
// same side, into the print it has just left. It is the one gait here
// that is not four evenly spaced beats, and it is why a cat crossing a
// room looks like it is being poured rather than carried.
const COUPLE = [0.7, 0.5, 0.2, 0];

// The pieces every one of them has, in the order they are drawn. A
// species adds to this; none of them reorders it, because back-to-front
// is a fact about animals rather than about any one of them.
const order = (extra = {}) => [
  { key: 'far0', kind: 'leg', leg: 0, fill: OFF, stroke: DARK, ...(extra.farLeg || {}) },
  { key: 'far1', kind: 'leg', leg: 1, fill: OFF, stroke: DARK, ...(extra.farLeg || {}) },
  ...(extra.behind || []),
  { key: 'body', kind: 'skin', fill: extra.bodyFill || PALE, stroke: DARK },
  ...(extra.over || []),
  { key: 'near0', kind: 'leg', leg: 2, fill: PALE, stroke: DARK, ...(extra.nearLeg || {}) },
  { key: 'near1', kind: 'leg', leg: 3, fill: PALE, stroke: DARK, ...(extra.nearLeg || {}) },
  ...(extra.front || []),
];

// `l3` and `toe` are the metatarsus of a digitigrade animal — the segment
// between the ankle and the toes it stands on. An ungulate leaves them
// off and gets the two-bone leg it has always had.
//
// `bend` is which way the middle joint folds: +1 throws it towards the
// head, -1 towards the tail. It is one character of a diff and it is the
// difference between a leg and a leg on backwards, so it is worth naming.
// See the dog's, which had a knee where its elbow should have been.
const leg = (on, hip, l1, l2, foot, ground, bend, beat, w, l3, toe, more) =>
  ({ on, hip, l1, l2, foot, ground, bend, phase: beat, w, l3, toe, ...(more || {}) });

// A hind leg drives and a fore leg reaches, so on every one of these the
// hind picks its foot up higher on the way through than the fore in front
// of it does. It does not take a *longer* step, though it used to be told
// to: every foot on one animal covers the same ground, because they are
// all bolted to the same body. See `step` in beast.js.
const HIND = { lift: 1.18 };
const FORE = { lift: 0.9 };

// ---------------------------------------------------------------------
// The cow. The one every other was measured against.

const COW = makeRig({
  // The cow is the default in every one of these — see SHARE, AIR and
  // BREATH_RATE in beast.js. It is written out here anyway, because a
  // reference that is only visible as an absence is one nobody finds.
  earBack: 34,
  breath: 0.022, breathRate: 0.0016,
  // A plod: a foot planted and the barrel carried over it.
  duty: 0.70, lift: 2.4, roll: 13, swing: 'plod', stride: 10.0,
  foot: 'cloven',
  // A degree and a half of rock, and the deepest nod of the three. A cow
  // walking swings its whole head and neck once a step, and it is the
  // thing you would pick a cow out by at the far side of a field.
  pitch: 1.5, nod: 1,
  // No baby-schema on this one. Every number below is where a cow's is,
  // and the last of the exaggeration has been folded back out of them:
  // what `cute` was doing here was a four per cent swell across the head
  // and a body squeezed an eighth shorter, on top of an outline that was
  // already drawn as a calf's. Two lots of the same thing on one animal,
  // and between them the head came out square. See `stretch` in beast.js
  // for the machinery, which the cat and the dog still use.
  bones: [
    // The spine sits a third of the way down the barrel rather than
    // halfway, which is where a spine is: the ribs hang off it.
    { name: 'hip', parent: null, head: [49.2, 15.8], angle: 180, len: 5.4 },
    { name: 'loin', parent: 'hip', head: [43.8, 15.8], angle: 180, len: 5.4 },
    { name: 'chest', parent: 'loin', head: [38.4, 15.8], angle: 180, len: 7.4 },
    // A neck, at last. It was six units long and dead level, which put the
    // poll where the withers are and left the head sitting straight on the
    // shoulder. Seven and a half, and sloping: a cow carries its head
    // below its withers and reaches forward for the grass.
    { name: 'neck1', parent: 'chest', head: [31.0, 15.9], angle: 175, len: 3.7 },
    { name: 'neck2', parent: 'neck1', head: [27.3, 16.2], angle: 174, len: 3.6 },
    { name: 'skull', parent: 'neck2', head: [23.7, 16.6], angle: 171, len: 9.4 },
    { name: 'ear', parent: 'skull', head: [24.4, 13.6], angle: 352, len: 5 },
    // The tail hangs down the near side of the rump and is drawn over it,
    // which is where a cow's tail is and — the reason it had to move — the
    // only place on this animal there is room for it. Behind the body, as
    // it was, and again hard against the rear edge, the rope ran along the
    // buttock's own line for its whole length; two strokes half a unit
    // apart are one thick stroke, and the cow had no visible tail at all.
    // Well inside the flank it is a pale rope on a pale ground, and it
    // crosses the outline once, low down, where crossing it reads as a tail
    // hanging over the buttock. See `front` below.
    { name: 'tail1', parent: 'hip', head: [51.6, 12.6], angle: 84, len: 5 },
    { name: 'tail2', parent: 'tail1', head: [52.1, 17.6], angle: 88, len: 5 },
    { name: 'tail3', parent: 'tail2', head: [52.3, 22.6], angle: 92, len: 5 },
  ],
  outline: [
    // The head: nine and a half long by seven deep, and the length is the
    // whole of it. It was ten by twelve — deeper than it was long, which
    // is a calf, and the note that used to sit here said as much and
    // called it a virtue. A grown cow's head is nearly half again as long
    // as it is deep, blunt at the muzzle and deepest at the cheek, and no
    // amount of detail on a square head makes up for the square.
    [15.0, 15.4, 'skull'], [16.8, 14.8, 'skull'], [18.8, 14.1, 'skull'],
    [20.8, 13.5, 'skull'], [22.4, 13.1, 'skull'], [23.8, 13.2, 'skull'],
    // The neck top, rising from the poll to the withers. A cow's head is
    // carried low; the topline is not one straight line from nose to tail.
    [25.8, 13.2, 'neck2'], [27.8, 13.0, 'neck2'],
    [29.6, 12.7, 'neck1'], [31.4, 12.3, 'neck1'],
    [33.2, 12.0, 'chest'], [36.6, 11.8, 'chest'],
    [39.9, 12.2, 'loin'], [43.4, 12.5, 'loin'],
    [45.9, 12.1, 'hip'], [49.8, 11.7, 'hip'], [52.4, 12.4, 'hip'],
    [54.1, 14.2, 'hip'], [54.7, 17.0, 'hip'], [54.1, 19.9, 'hip'],
    // The buttock hangs lower than the belly does, which is what keeps a
    // raised barrel from reading as a plank on sticks.
    [53.4, 22.6, 'hip'], [51.4, 24.8, 'hip'], [48.0, 25.4, 'hip'],
    // The belly, and it is high. This is the change that does most of the
    // work: the barrel was eighteen deep with eight and a half of daylight
    // under it, which is a calf standing in long grass. A cow is about as
    // deep through the ribs as it is tall from brisket to ground.
    [44.2, 25.2, 'loin'], [40.5, 25.1, 'loin'], [37.0, 24.8, 'chest'],
    [34.2, 23.9, 'chest'], [32.0, 22.0, 'chest'],
    // And a dewlap. It is one swell in the line under the neck and it is
    // worth more than anything else this size on the animal: nothing else
    // in the family has one, and it says cattle before the horns do.
    [30.2, 22.0, 'neck1'], [28.4, 22.2, 'neck2'], [26.6, 21.7, 'neck2'],
    // The jaw, and it runs on into the dewlap with only a dent at the
    // throatlatch between them, because that is what the underside of a
    // cow does. Drawn as a jaw that stopped and a dewlap that started, the
    // step between the two read as a second chin.
    [24.8, 20.6, 'skull'], [22.8, 21.0, 'skull'], [20.3, 21.0, 'skull'],
    [17.8, 20.6, 'skull'], [16.0, 20.0, 'skull'], [14.8, 19.0, 'skull'],
    [14.2, 17.6, 'skull'], [14.3, 16.2, 'skull'],
  ],
  legs: [
    // Long, because they were short. A cow stands about as far off the
    // ground as it is deep through the barrel, and the knee and the hock
    // are both well clear of the belly — which they could not be while the
    // belly hung to within eight units of the floor. The fore is a post
    // with its carpus a little over half way down; the hind keeps the
    // angular zigzag that says cattle. The third number in each width list
    // is the joint: a little wider than its neighbours, so there is a knee
    // to see rather than an even taper.
    leg('chest', [35.9, 18.5], 8.8, 7.5, 34.4, FAR, 1, WALK[0], [5.1, 4.0, 4.2, 2.7, 2.4], 0, 0, FORE),
    leg('hip', [50.2, 17.8], 12.4, 6.8, 51.6, FAR, -1, WALK[1], [5.9, 4.9, 5.1, 3.0, 2.6], 0, 0, HIND),
    leg('chest', [33.0, 18.2], 9.8, 8.4, 31.4, GROUND, 1, WALK[2], [5.6, 4.4, 4.6, 3.0, 2.6], 0, 0, FORE),
    leg('hip', [47.7, 17.4], 13.8, 7.7, 49.4, GROUND, -1, WALK[3], [6.6, 5.4, 5.6, 3.2, 2.8], 0, 0, HIND),
  ],
  pieces: order({
    behind: [
      { key: 'hornA', kind: 'rigid', bone: 'skull', points: [[21.4, 13.3], [22.1, 10.4], [23.2, 13.0]], fill: PALE, stroke: DARK },
      { key: 'hornB', kind: 'rigid', bone: 'skull', points: [[23.3, 13.0], [24.1, 10.3], [25.0, 12.8]], fill: PALE, stroke: DARK },
    ],
    over: [
      // Ear-sized, and behind the poll. It was nine units long on a head
      // nine and a half long, which is not an ear, it is a wing — and lying
      // forward over the face like that it read as a second eye. Set across
      // the crest rather than under it: an ear wholly inside the silhouette
      // is a hole in the neck, and half of one standing proud of the line
      // is the only way this reads as an ear at the size it is drawn.
      { key: 'ear', kind: 'rigid', bone: 'ear', points: ring(27.0, 13.4, 2.6, 1.4, 14), fill: PALE, stroke: DARK },
    ],
    front: [
      { key: 'shoulder', kind: 'rigid', bone: 'chest', points: [[30.9, 15.6], [33.4, 12.8], [36.4, 13.4], [37.2, 17.2], [36.6, 21.6], [34.6, 23.4], [32.6, 22.2], [30.6, 19.0]], fill: PALE },
      { key: 'thigh', kind: 'rigid', bone: 'hip', points: [[44.2, 16.8], [48.0, 14.0], [51.9, 14.8], [53.2, 18.4], [52.8, 22.0], [50.2, 24.6], [47.2, 24.0], [44.8, 20.2]], fill: PALE },
      { key: 'creaseA', kind: 'line', bone: 'chest', points: [[33.6, 12.6], [31.9, 16.0], [31.4, 19.4], [32.3, 22.0], [33.9, 23.4]], fill: 'none', stroke: DARK },
      { key: 'creaseB', kind: 'line', bone: 'hip', points: [[44.8, 13.8], [44.4, 17.4], [45.3, 20.8], [47.3, 23.2], [49.0, 24.6]], fill: 'none', stroke: DARK },
      { key: 'spotA', kind: 'skin', points: ring(39.4, 15.6, 4.2, 2.6, 8, 12).map(([x, y]) => [x, y, 'loin']), fill: DARK },
      { key: 'spotB', kind: 'skin', points: ring(42.5, 21.6, 3.4, 2.2, -10, 12).map(([x, y]) => [x, y, 'loin']), fill: DARK },
      { key: 'eye', kind: 'rigid', bone: 'skull', points: ring(20.8, 16.4, 1.4, 1.4, 0, 12), fill: DARK },
      { key: 'nose', kind: 'rigid', bone: 'skull', points: ring(16.6, 17.9, 0.95, 0.75, -14, 8), fill: DARK },
      // The tail, last of all, because it hangs in front of the rump it
      // comes off. There is no nose pad any more to keep it company: a head
      // eight units deep has room for an outline, an eye and a nostril, and
      // the pad that used to be drawn on the muzzle put a second stroke
      // within half a unit of the first and turned the whole front of the
      // face solid. What it was there to say — that the head ends in
      // something rather than merely stopping — the nostril says on its own.
      { key: 'tail', kind: 'rope', chain: ['tail1', 'tail2', 'tail3'], w: [3.2, 2.6, 2.1, 1.7], fill: PALE, stroke: DARK },
      { key: 'tuft', kind: 'rigid', bone: 'tail3', points: ring(52.0, 29.2, 1.9, 2.9, 0, 12), fill: PALE, stroke: DARK },
    ],
  }),
});



// ---------------------------------------------------------------------
// The dog, and it is a beagle.
//
// What made it a dog was three things the outline could say — a chest that
// drops between the front legs, a waist that tucks up behind the ribs, and
// a muzzle that comes out in front of the head instead of down under it.
// None of those is what makes it a *beagle*, because a breed is hardly
// ever a silhouette. Ask anyone to draw one and you get a white dog with a
// black blanket over its back, a tan head, and a pair of ears too long and
// too wide for it, hanging. Three of those four are coat and not shape,
// which is why this is the first animal here with more than one colour in
// it beyond the line round the outside.

const DOG = makeRig({
  // Restless. A dog is never quite still: the drift is the biggest of the
  // three and the quickest, the head counter-bobs hard against a bouncy
  // trot, and the stoop is taken mostly in the skull because there is not
  // much neck in front of the withers to take it.
  earBack: 40,
  breath: 0.026, breathRate: 0.0026,
  air: { chest: 1.1, loin: 0.6, hip: 0.3, neck1: 0.3 },
  share: {
    chest: { beat: 0.60, idle: [0.70, 0.41, 0.29] },
    neck1: { head: -0.30, beat: -0.70, idle: [1.00, 0.37, 0.53] },
    neck2: { head: -0.33, beat: -0.60, drag: ['neck1', 0.040], idle: [1.30, 0.33, 0.47] },
    skull: { head: -0.70, beat: -1.00, drag: ['neck2', 0.055], idle: [1.70, 0.29, 0.43] },
    // Up, and bouncing on the trot rather than swinging on a walk: the
    // tail answers the twice-a-stride beat and hardly notices the long
    // swing at all, which is the opposite of the cow behind it.
    tail1: { beat: 0.30, sway: -0.10 },
    tail2: { beat: 0.55, sway: -0.15 },
    tail3: { swish: 1.15, beat: 0.85, sway: -0.20, drag: ['tail2', 0.085] },
  },
  // Quick and snappy: a dog's head answers at once and overshoots.
  loose: { neck1: [2.8, 0.55], neck2: [2.4, 0.45], skull: [2.1, 0.34] },
  // A short step, taken often. All three of these came down together,
  // because between them they are what made the dog read as leggy: a foot
  // that swings four units either side of where it stands takes the leg
  // with it, and a leg swung that far is a leg on show. Half of what looks
  // like too much leg on any animal is not the leg, it is how far the leg
  // goes. Six and a bit, and the feet stay under the dog.
  //
  // `stride` is not free — see `carry` in beast.js and the beat it feeds
  // in animals.js. A shorter step at the same speed across the page is a
  // quicker one, and on its own this would have put a third of a stride a
  // second on the dog. It did not, because the speed came down with it:
  // two and a half strides a second against the two and two-thirds it was,
  // which is near enough the same feet at a slower dog. The pair have to
  // move together or one of them is wrong.
  //
  // And the lift with them, because a foot that leaves the ground by a
  // third of the leg it is on has to fold that third away somewhere, and
  // it was all going into one flat tibia carried through the swing like a
  // shelf. Still the highest of the three.
  duty: 0.44, lift: 2.8, roll: 18, swing: 'trot', stride: 6.2,
  // A trot is the bouncy one and the level one at once: a little more
  // rock than the cow, and almost no nod, because a dog at a trot carries
  // its head like a tray. What moves instead is everything behind it.
  //
  // These were 3.0 and 1.5, which is where the bounce of a trot seemed to
  // belong and is the wrong place for it. Rock and bob move the shoulder
  // up and down, and whatever the shoulder does the knee under it has to
  // absorb — so what matters is not how big the movement is but how big it
  // is *against the leg*. This dog has the shortest legs of the three and
  // only eight units of thigh-and-shank between its elbow and its wrist,
  // so three degrees of rock shut its knee to ninety-five: a right angle,
  // held, every step. The cow loses three degrees of knee to the same
  // numbers and the dog lost twenty-five.
  //
  // The bounce of a trot lives in the legs instead, where it always did —
  // the shortest stance and the highest lift of the three, below.
  pitch: 1.8, bob: 1.05, nod: 0.25,
  // A dog lands on a pad, in front of the cannon: it walks on its toes.
  foot: 'paw',
  cute: { pivot: 27.0, head: [0.92, 1.28], body: 0.82, centre: 17.0, drop: 0.8 },
  bones: [
    { name: 'hip', parent: null, head: [50.0, 19.0], angle: 180, len: 5.0 },
    { name: 'loin', parent: 'hip', head: [45.0, 19.0], angle: 180, len: 5.5 },
    { name: 'chest', parent: 'loin', head: [39.5, 19.2], angle: 180, len: 7.5 },
    // The neck rises. A dog carries its head above its withers and a cow
    // does not, and that one difference does more than the outline does.
    { name: 'neck1', parent: 'chest', head: [32.0, 19.2], angle: 198, len: 3.6 },
    { name: 'neck2', parent: 'neck1', head: [28.6, 18.1], angle: 198, len: 3.4 },
    { name: 'skull', parent: 'neck2', head: [25.4, 17.0], angle: 166, len: 10 },
    { name: 'ear', parent: 'skull', head: [24.6, 12.8], angle: 84, len: 6 },
    { name: 'tail1', parent: 'hip', head: [52.4, 17.6], angle: -42, len: 3.6 },
    { name: 'tail2', parent: 'tail1', head: [55.1, 15.2], angle: -30, len: 3.2 },
    { name: 'tail3', parent: 'tail2', head: [57.9, 13.6], angle: -18, len: 2.8 },
  ],
  outline: [
    // Two shapes, not one taper: a deep round braincase and a short blunt
    // muzzle, with a step between them. Fourteen long by ten deep, where
    // it was fourteen by six — the stop was already written down here but
    // there was no depth behind it for the stop to be a step *in*.
    [13.2, 16.2, 'skull'], [15.0, 15.6, 'skull'], [17.4, 15.2, 'skull'],
    // The stop. A dog's brow comes up out of its muzzle; a lamb's slopes
    // off it, and that is the whole difference between the two.
    [18.8, 13.2, 'skull'], [20.8, 11.6, 'skull'], [23.2, 11.0, 'skull'],
    [25.6, 11.6, 'skull'],
    [27.6, 12.8, 'neck2'], [29.8, 14.0, 'neck1'], [31.6, 14.5, 'neck1'],
    [33.8, 14.8, 'chest'], [37.4, 15.0, 'chest'], [41.4, 15.2, 'loin'],
    [45.4, 15.0, 'loin'], [49.0, 14.8, 'hip'], [51.6, 15.4, 'hip'],
    [53.2, 17.2, 'hip'], [53.8, 20.0, 'hip'], [53.2, 23.0, 'hip'],
    [51.8, 25.4, 'hip'], [49.6, 27.0, 'hip'],
    // The tuck-up: the belly climbs from the chest back to the waist,
    // which is the line that says dog rather than small cow.
    [46.8, 27.4, 'hip'], [43.6, 26.6, 'loin'], [40.4, 26.4, 'loin'],
    [37.4, 27.4, 'chest'], [34.6, 28.4, 'chest'], [32.6, 27.4, 'chest'],
    [31.4, 25.0, 'neck1'], [30.4, 22.6, 'neck1'],
    // The throat cuts in hard behind the jaw. Without it the head and the
    // neck are one pipe and there is no head to be fond of.
    [28.8, 21.4, 'neck2'], [26.6, 20.6, 'skull'], [24.2, 21.4, 'skull'],
    [21.4, 21.9, 'skull'], [18.6, 21.9, 'skull'], [16.0, 21.3, 'skull'],
    [14.0, 20.2, 'skull'], [12.9, 19.2, 'skull'], [12.3, 17.7, 'skull'],
  ],


  legs: [
    // Three segments, and seven widths to go with them: the joints land
    // on indices 2 and 4.
    //
    // `bend` is which way the middle joint folds, and both of these were
    // the cow's — which is how this dog came to walk on four knees. A
    // knee is a hind leg's joint. What an animal has in front is an
    // elbow, and an elbow folds the other way: the fore's mid joint goes
    // back (-1) and the hind's goes forward (+1). Written the cow's way
    // round the fore threw its elbow forward like a forearm being raised
    // and the hind put its stifle behind and its hock in front, which is
    // no animal at all — it is the Z of a hind leg held up to a mirror.
    // The right way round, the hind is the Z it should have been: stifle
    // forward, hock back, metatarsus down and forward again, which is the
    // spring a dog stands on.
    //
    // The hind is properly angulated, which is the other half of the
    // legginess. A dog's stifle and hock are folded when it is standing
    // still — the femur and the tibia meet at something like a hundred and
    // fifteen degrees — and a hind leg written short enough to come out
    // nearly straight at mid-stance is a hind leg on stilts, whichever way
    // its joints bend. Femur and tibia are long enough now that the leg
    // never comes past about eighty-five per cent of its own length, which
    // is where a dog's is standing square.
    //
    // The lower half of every one of these is thicker, too. It is the same
    // point from the other side: a leg reads as leggy when it is thin, and
    // these tapered to a cannon two and a half units wide under a barrel
    // eighteen deep, which is a wading bird.
    //
    // And the humerus is short — half what it was, with the length handed
    // down to the forearm and the pastern under it. A dog's front leg is
    // not a zigzag, it is a post: the elbow is tucked into the chest and
    // everything below it drops in one line to the pad. A fore leg carries slack
    // however it is written, because the foot swings through a stride the
    // hip does not, and a two-bone solve puts all of that slack out
    // sideways at the middle joint. How far sideways is capped by the
    // shorter of the two bones — so a short humerus cannot throw the
    // elbow further than the shoulder patch that covers it, and the fold
    // happens where a dog's fold is: out of sight, under the coat.
    //
    // `toe` leans the last segment, measured up the leg from the foot.
    // Behind, it was negative, which stood the hock in front of the toes
    // and sloped the rear pastern back-to-front. Every corner of a dog
    // stands with its ankle behind its toes — that is what walking on the
    // toes means — so it is positive on all four, and by enough to see:
    // four degrees is a post, and the one break below the elbow that the
    // eye can find on a front leg is the wrist.
    leg('chest', [37.0, 23.4], 3.1, 6.3, 36.2, FAR, -1, TROT[0],
      [5.0, 4.2, 4.4, 3.8, 4.0, 3.1, 2.6], 3.0, 12, FORE),
    leg('hip', [50.6, 22.4], 6.1, 4.5, 51.4, FAR, 1, TROT[1],
      [5.4, 4.6, 4.8, 4.0, 4.2, 3.2, 2.7], 3.8, 16, HIND),
    leg('chest', [34.0, 23.0], 3.6, 7.3, 33.4, GROUND, -1, TROT[2],
      [5.4, 4.5, 4.8, 4.0, 4.2, 3.3, 2.9], 3.4, 12, FORE),
    leg('hip', [48.4, 22.0], 7.0, 5.2, 49.3, GROUND, 1, TROT[3],
      [6.0, 5.1, 5.4, 4.4, 4.6, 3.5, 3.0], 4.2, 16, HIND),
  ],
  pieces: order({
    farLeg: { hoofFill: OFF, hoofStroke: DARK },
    nearLeg: { hoofFill: PALE, hoofStroke: DARK },
    behind: [
      // Tan, so that the white on the end of it has something to be the
      // end of. A white tip on a white tail is a tip nobody can see, and
      // the flag on the end of a beagle's stern is half of what the back
      // of one looks like going away from you.
      { key: 'tail', kind: 'rope', chain: ['tail1', 'tail2', 'tail3'], w: [3.4, 2.8, 2.2, 1.7], fill: TAN, stroke: DARK },
      { key: 'flag', kind: 'rigid', bone: 'tail3', points: ring(59.5, 13.2, 1.7, 1.3, -18, 10), fill: PALE, stroke: DARK },
    ],
    over: [
      // And the head, which is tan from the stop back. Skin again, and on
      // two bones, because the back of it is behind the skull and a piece
      // pinned rigidly to the skull alone would swing off the neck every
      // time the head went down.
      { key: 'mask', kind: 'skin', blend: 4, fill: TAN,
        points: [
          [16.6, 16.0, 'skull'], [18.6, 14.2, 'skull'], [20.8, 12.6, 'skull'],
          [23.2, 12.0, 'skull'], [25.6, 12.6, 'neck2'], [27.3, 13.9, 'neck2'],
          [28.0, 16.4, 'neck2'], [27.4, 19.2, 'neck2'], [25.8, 20.4, 'neck2'],
          [22.8, 21.0, 'skull'], [19.6, 21.1, 'skull'], [16.8, 20.5, 'skull'],
          [15.0, 19.4, 'skull'], [14.4, 17.6, 'skull'],
        ] },
      // Hanging, and drawn over the head rather than behind it, because a
      // dropped ear lies on the side of the face. Long enough to hang past
      // the jaw: one drawn wholly inside the head is a hole cut in it.
      // The muzzle, merged into the silhouette at the front so only its
      // back edge shows: a pad drawn wholly inside the outline is a cork.
      { key: 'muzzle', kind: 'rigid', bone: 'skull',
        points: [[16.2, 16.3], [14.6, 15.4], [13.2, 15.8], [12.2, 17.6],
                 [12.9, 19.6], [14.5, 20.3], [15.8, 19.6], [16.4, 17.8]],
        fill: PALE, stroke: DARK },
      // And the ear hangs off the *back* of the skull, behind the eye.
      // It was pinned over the middle of the face, where the only thing
      // it could do was swallow the eye.
      //
      // Half again as wide and a third longer than the dog's was, and it
      // hangs past the jaw rather than stopping level with it. A beagle's
      // ear is the one measurement of the breed that everybody has right
      // without being able to say so: too big, set low, and rounded at the
      // bottom rather than pointed.
      { key: 'ear', kind: 'rigid', bone: 'ear', points: ring(25.6, 17.2, 2.4, 4.7, 10), fill: TAN, stroke: DARK },
    ],
    front: [
      // The quarters, which are what the blanket stops at. On every other
      // animal here these two are the colour of the body and do one job —
      // covering the top of a near leg, so the leg comes out from under
      // something rather than being stuck on. Tan, they do a second: a
      // beagle's shoulder and haunch are the tan between the black on its
      // back and the white on its legs, and that is three of its colours
      // in the order they actually go.
      //
      // Both were drawn a unit or so outside the outline, which nobody
      // could see while they were the same pale as the body they sat on.
      // In a colour of their own it would have been a tan bulge hanging
      // off the belly, so both are inside the line now.
      { key: 'shoulder', kind: 'rigid', bone: 'chest', points: [[31.6, 20.6], [34.2, 18.6], [36.8, 20.0], [37.4, 23.4], [36.6, 26.4], [34.4, 27.6], [32.4, 26.4], [31.2, 23.6]], fill: TAN },
      { key: 'thigh', kind: 'rigid', bone: 'hip', points: [[45.8, 20.4], [48.8, 18.4], [51.6, 19.6], [52.6, 22.6], [51.4, 24.8], [49.4, 26.4], [47.0, 25.8], [45.6, 23.2]], fill: TAN },
      // The blanket, and it goes on *after* the quarters rather than under
      // them. Under them it was two tan eggs laid on a black back: the
      // quarters are drawn last of all because they have to cover the top
      // of a near leg, so whatever they are the colour of wins, and two
      // clean ellipses punched out of a coat is the one thing no animal
      // has on it. Over them, the same two shapes read the way they do on
      // the dog — tan coming out from under the black, and the white leg
      // out from under the tan.
      //
      // Skin rather than a loose piece, so it bends with the back it is
      // on; a marking painted on a barrel that swells with the breath has
      // to swell with it or it is a sticker. And drawn a good unit inside
      // the outline the whole way round, because anything laid over the
      // body that reaches the edge of it will find the edge somewhere in
      // the stride, and black with a rim of white outside it is a hole.
      { key: 'saddle', kind: 'skin', blend: 5, fill: DARK,
        points: [
          [34.0, 17.2, 'neck1'], [37.0, 16.0, 'chest'], [41.0, 15.9, 'chest'],
          [45.0, 15.8, 'loin'], [48.6, 15.7, 'hip'], [51.0, 16.6, 'hip'],
          [52.0, 19.0, 'hip'], [51.6, 22.2, 'hip'], [50.0, 24.6, 'hip'],
          [46.5, 25.4, 'loin'], [42.5, 25.2, 'loin'], [38.5, 24.6, 'chest'],
          [35.6, 23.0, 'chest'], [34.0, 20.4, 'neck1'],
        ] },
      { key: 'creaseA', kind: 'line', bone: 'chest', points: [[34.6, 16.4], [32.6, 20.2], [32.2, 23.6], [33.2, 26.8], [34.8, 28.6]], fill: 'none', stroke: DARK },
      { key: 'creaseB', kind: 'line', bone: 'hip', points: [[45.8, 17.2], [45.2, 21.0], [46.0, 24.4], [47.8, 26.6], [49.4, 27.4]], fill: 'none', stroke: DARK },
      { key: 'eye', kind: 'rigid', bone: 'skull', points: ring(19.3, 15.7, 1.9, 1.9, 0, 12), fill: DARK },
      { key: 'nose', kind: 'rigid', bone: 'skull', points: ring(12.7, 17.3, 1.35, 1.15, -12, 10), fill: DARK },
    ],
  }),
});

// ---------------------------------------------------------------------
// The cat, and it is a Birman kitten.
//
// Which puts the baby-schema back where it was and further: a Birman
// kitten is head and eyes and very little else, and this is the one animal
// in the three that is meant to be young rather than small.
//
// The coat is a colourpoint, which is the easiest of all of these to draw
// and the easiest to get wrong. Easy, because it is one pale body with the
// dark gathered at the ends of it — mask, ears, legs, tail — and no
// pattern anywhere in the middle. Wrong, because the thing that makes it a
// *Birman* and not any other seal point is four white gloves on four dark
// feet, and a glove only exists if the body behind it is not also white.
// So the body is a cream a shade off the pale rather than the pale itself,
// and the gloves are the pale. That one step is the whole breed.
//
// The other half of it is the eyes, which are round, enormous and blue.

const CAT = makeRig({
  // The opposite of the dog in every one of these. A cat standing still is
  // still — the drift is a sixth of the dog's — and it does not bob, so
  // the head barely argues with the body. What it does instead is lag:
  // the drag terms are the highest here, which is what makes a cat pour.
  earBack: 46,
  breath: 0.020, breathRate: 0.0030,
  air: { chest: 0.8, loin: 0.5, hip: 0.3, neck1: 0.25 },
  share: {
    hip: { idle: [0.12, 0.13, 0.09] },
    loin: { beat: 0.10, idle: [0.14, 0.11, 0.17] },
    chest: { beat: 0.15, idle: [0.16, 0.09, 0.15] },
    neck1: { head: -0.28, beat: -0.20, drag: ['chest', 0.045], idle: [0.24, 0.07, 0.13] },
    neck2: { head: -0.34, beat: -0.20, drag: ['neck1', 0.060], idle: [0.30, 0.06, 0.11] },
    skull: { head: -0.72, beat: -0.25, drag: ['neck2', 0.080], idle: [0.38, 0.05, 0.09] },
    // Held up and trailing. With the back as level as it is, the tail is
    // the whole of what a walking cat has to say, so it gets the deepest
    // long swing of the three and the slowest springs to arrive on.
    tail1: { sway: -0.55 },
    tail2: { sway: -1.00 },
    tail3: { sway: -1.40 },
  },
  // Loose. A cat pours rather than turns, and this is where that is
  // said: slow springs, barely damped, so every movement carries on a
  // moment after it is over.
  loose: { chest: [2.6, 0.7], neck1: [1.9, 0.46], neck2: [1.6, 0.38], skull: [1.35, 0.28] },
  // A cat does not bob and a cat does not stamp.
  duty: 0.62, lift: 1.9, roll: 9, swing: 'stalk', stride: 8.2,
  // And it barely rocks and barely nods. A cat's back is the most level
  // thing here — the legs go and the line along the top does not answer
  // — which is the other half of the pouring, the first half being the
  // couplets its feet come down in.
  pitch: 0.5, nod: 0.15,
  foot: 'paw',
  cute: { pivot: 27.4, head: [0.86, 1.32], body: 0.85, centre: 20.2, drop: -0.8 },
  bones: [
    { name: 'hip', parent: null, head: [46.0, 21.5], angle: 180, len: 4.0 },
    { name: 'loin', parent: 'hip', head: [42.0, 21.5], angle: 180, len: 4.0 },
    { name: 'chest', parent: 'loin', head: [38.0, 21.5], angle: 180, len: 6.0 },
    { name: 'neck1', parent: 'chest', head: [32.0, 21.4], angle: 190, len: 2.4 },
    { name: 'neck2', parent: 'neck1', head: [29.6, 21.0], angle: 190, len: 2.2 },
    { name: 'skull', parent: 'neck2', head: [27.4, 20.6], angle: 172, len: 12 },
    { name: 'ear', parent: 'skull', head: [25.6, 16.4], angle: 300, len: 4 },
    { name: 'tail1', parent: 'hip', head: [48.6, 20.8], angle: -75, len: 4.6 },
    { name: 'tail2', parent: 'tail1', head: [49.8, 16.4], angle: -55, len: 4.2 },
    { name: 'tail3', parent: 'tail2', head: [52.2, 12.9], angle: -14, len: 3.6 },
  ],
  outline: [
    [15.6, 19.2, 'skull'], [18.4, 17.2, 'skull'], [21.4, 15.6, 'skull'],
    [24.2, 15.0, 'skull'], [26.8, 15.2, 'skull'], [28.6, 16.4, 'neck2'],
    [30.6, 17.2, 'neck1'], [32.6, 17.6, 'neck1'], [35.0, 17.6, 'chest'],
    [38.4, 17.4, 'chest'], [41.8, 17.4, 'loin'], [44.8, 17.8, 'loin'],
    [47.2, 18.8, 'hip'], [48.8, 20.6, 'hip'], [49.4, 23.4, 'hip'],
    [48.6, 26.2, 'hip'], [47.0, 28.2, 'hip'], [44.8, 29.2, 'hip'],
    [42.0, 29.6, 'loin'], [38.8, 29.6, 'loin'], [35.8, 29.2, 'chest'],
    [33.2, 28.2, 'chest'], [31.4, 26.4, 'neck1'], [30.2, 24.4, 'neck1'],
    [29.0, 23.0, 'neck2'], [27.6, 22.6, 'neck2'], [25.8, 23.6, 'skull'],
    [22.8, 24.6, 'skull'], [19.6, 24.8, 'skull'], [16.8, 24.2, 'skull'],
    [14.8, 22.8, 'skull'], [14.2, 21.0, 'skull'], [14.4, 19.8, 'skull'],
  ],
  legs: [
    // The hind feet are set well forward of where the leg would rest,
    // which is the readable half of direct register: a cat puts its hind
    // foot into the print its fore foot has just left, so the two tracks
    // very nearly coincide and the whole animal walks in one line.
    //
    // The metatarsus stands nearer upright than it did. Leaning it twenty
    // degrees back put a third fold in a leg that already had two, and
    // three folds in a leg this short is not a cat crouching, it is a cat
    // that has been sat on.
    // Shorter in the bone than the cat before it, because the body sits a
    // unit nearer the floor: a kitten's legs are short, and a leg that
    // keeps its length while the shoulder above it comes down has nowhere
    // to put the difference but the knee. See the dog, which lost
    // twenty-five degrees of knee to the same arithmetic from the other
    // direction.
    leg('chest', [36.4, 24.4], 5.7, 3.9, 35.4, FAR, 1, COUPLE[0],
      [4.4, 3.7, 3.9, 2.8, 3.0, 2.3, 2.1], 3.4, 4, FORE),
    leg('hip', [46.6, 23.8], 5.5, 4.0, 44.9, FAR, -1, COUPLE[1],
      [4.6, 3.9, 4.1, 2.9, 3.1, 2.4, 2.2], 4.0, -12, HIND),
    leg('chest', [34.0, 24.0], 6.5, 4.4, 33.0, GROUND, 1, COUPLE[2],
      [4.8, 4.0, 4.2, 3.0, 3.2, 2.5, 2.3], 3.8, 4, FORE),
    leg('hip', [44.8, 23.4], 6.1, 4.5, 43.2, GROUND, -1, COUPLE[3],
      [5.2, 4.4, 4.6, 3.2, 3.4, 2.6, 2.4], 4.6, -12, HIND),
  ],
  bob: 0.7,
  pieces: order({
    bodyFill: CREAM,
    // The points and the gloves, and they fall straight out of the way a
    // leg is already drawn: the leg is one shape and the foot on the end
    // of it is another, so a dark leg with a pale foot is two fills and no
    // new pieces at all. It is the only marking in this file that the rig
    // was already shaped to say.
    farLeg: { fill: far(POINT), hoofFill: OFF, hoofStroke: DARK },
    nearLeg: { fill: POINT, hoofFill: PALE, hoofStroke: DARK },
    behind: [
      // Plumed. A Birman is a longhair and the tail is where that shows at
      // this size — barely tapered, and thicker at the root than the cat
      // before it had at its thickest.
      { key: 'tail', kind: 'rope', chain: ['tail1', 'tail2', 'tail3'], w: [3.6, 3.3, 2.9, 2.4], fill: POINT, stroke: DARK },
      // The far ear, small and mostly hidden: it is there so the near one
      // reads as one of a pair rather than as a fin.
      { key: 'earB', kind: 'rigid', bone: 'skull', points: [[27.2, 14.8], [29.0, 11.6], [30.3, 15.4]], fill: far(POINT), stroke: DARK },
    ],
    over: [
      // Two corners, and they are the cat. Nothing else here has one
      // anywhere on it. Upright and close together, because a pair leaning
      // away from each other over a big round head is a bat.
      { key: 'earA', kind: 'rigid', bone: 'ear', points: [[20.6, 15.2], [22.2, 9.6], [26.2, 13.8]], fill: POINT, stroke: DARK },
      // The mask. Skin and not a loose piece, and on two bones, because
      // the back of it is behind the skull — see the beagle's, which is
      // the same shape doing the same job in a different colour.
      //
      // It stops short of the brow. A mask taken right over the top of the
      // head is a balaclava, and what says colourpoint is that the pale of
      // the body comes down the forehead to meet it.
      { key: 'mask', kind: 'skin', blend: 4, fill: POINT,
        points: [
          [15.2, 19.6, 'skull'], [17.2, 17.8, 'skull'], [19.6, 16.3, 'skull'],
          [22.2, 16.5, 'skull'], [23.6, 18.0, 'skull'], [24.0, 20.0, 'skull'],
          [23.4, 22.0, 'skull'], [21.6, 23.4, 'skull'], [19.2, 24.0, 'skull'],
          [16.8, 23.8, 'skull'], [15.0, 22.6, 'skull'], [14.5, 20.9, 'skull'],
        ] },
      // A cheek. A head with an eye and no muzzle is a bean — and on this
      // one the muzzle is inside the mask rather than pale against it, so
      // what it contributes is its line and not its colour.
      { key: 'cheek', kind: 'rigid', bone: 'skull',
        points: [[18.6, 20.0], [17.2, 19.1], [15.8, 19.5], [14.5, 21.2],
                 [15.0, 23.2], [16.5, 24.2], [17.9, 23.6], [18.7, 21.7]],
        fill: POINT, stroke: DARK },
    ],
    front: [
      // The quarters, in the ground colour rather than in the pale: they
      // are here to cover the top of a near leg and nothing else, and on a
      // coloured animal a pale one would be a hole. See the beagle, where
      // the same two shapes went wrong the same way.
      //
      // On this one they earn a second keep. A colourpoint's leg does not
      // begin dark at the shoulder, it shades into it — and a cream shape
      // laid over the top of a dark leg is exactly that, for nothing.
      { key: 'shoulder', kind: 'rigid', bone: 'chest', points: [[31.2, 21.6], [33.8, 19.8], [36.4, 21.0], [37.0, 24.6], [36.0, 28.0], [33.8, 29.4], [31.8, 27.8], [30.8, 24.6]], fill: CREAM },
      { key: 'thigh', kind: 'rigid', bone: 'hip', points: [[42.6, 21.2], [45.6, 19.2], [48.2, 20.4], [49.2, 23.6], [48.6, 26.8], [46.6, 29.0], [44.2, 28.2], [42.6, 24.6]], fill: CREAM },
      { key: 'creaseA', kind: 'line', bone: 'chest', points: [[33.6, 18.4], [31.8, 21.6], [31.4, 25.0], [32.4, 27.8], [33.8, 29.0]], fill: 'none', stroke: DARK },
      // Round, huge and blue, and with no line round it. Every other eye
      // in this file is a dark disc and takes its edge for granted; this
      // one is a colour, and a stroke a unit and a half wide laid on a
      // circle two and a half across leaves a rim of blue too thin to be a
      // colour at all. The pupil inside it does the holding instead, which
      // is what a pupil is for.
      { key: 'eye', kind: 'rigid', bone: 'skull', points: ring(20.6, 18.7, 2.7, 2.7, 0, 14), fill: BLUE },
      { key: 'pupil', kind: 'rigid', bone: 'skull', points: ring(20.5, 18.7, 1.15, 1.5, 0, 10), fill: DARK },
      { key: 'nose', kind: 'rigid', bone: 'skull', points: ring(16.2, 20.9, 1.15, 0.95, -10, 8), fill: DARK },
    ],
  }),
});

export const RIGS = { cow: COW, dog: DOG, cat: CAT };
