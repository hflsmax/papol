import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pageStops, positionOf, sectionStops, stopAt, stopName,
} from './sectionStops.js';

// A short paper: a heading a little way down page one, then one per page.
const outline = [
  { id: 's0', level: 0, number: '1', title: 'Introduction', page: 1, y: 0.7 },
  { id: 's1', level: 0, number: '2', title: 'Method', page: 2, y: 1 },
  { id: 's1a', level: 1, number: '2.1', title: 'Setup', page: 2, y: 0.5 },
  { id: 's2', level: 0, number: '3', title: 'Results', page: 3, y: 0.4 },
  { id: 's3', level: 0, title: 'References', page: 4, y: 0.9, appendix: true },
];

const rounded = (value) => Math.round(value * 1000) / 1000;

test('a place is a page and how far down it', () => {
  assert.equal(positionOf(1, 1), 0);
  assert.equal(positionOf(1, 0.75), 0.25);
  assert.equal(positionOf(3, 0), 3);
  // A missing page or height is the top of page one.
  assert.equal(positionOf(undefined, undefined), 1);
});

test('the sections stand in the paper\'s order, one level only, each as long as its run to the next', () => {
  const stops = sectionStops(outline, 4);
  assert.deepEqual(stops.map(stopName), ['Start', '1 Introduction', '2 Method', '3 Results', 'References']);
  assert.deepEqual(stops.map((stop) => rounded(stop.at)), [0, 0.3, 1, 2.6, 3.1]);
  assert.deepEqual(stops.map((stop) => rounded(stop.span)), [0.3, 0.7, 1.6, 0.5, 0.9]);
  assert.equal(stops[0].front, true);
  assert.equal(stops[4].appendix, true);
});

test('the notices a paper closes on are one stop, End, and the last section stops before them', () => {
  const closed = [
    { id: 's0', level: 0, number: '1', title: 'Introduction', page: 1, y: 1 },
    { id: 's1', level: 0, number: '2', title: 'Conclusion', page: 2, y: 1 },
    { id: 's2', level: 0, title: 'End', end: true, page: 3, y: 0.5 },
  ];
  const stops = sectionStops(closed, 5);
  assert.deepEqual(stops.map(stopName), ['1 Introduction', '2 Conclusion', 'End']);
  assert.deepEqual(stops.map((stop) => rounded(stop.span)), [1, 1.5, 2.5]);
});

test('the outline\'s order gives way to the paper\'s', () => {
  const shuffled = [outline[3], outline[0], outline[1]];
  assert.deepEqual(sectionStops(shuffled, 4).map(stopName), ['Start', '1 Introduction', '2 Method', '3 Results']);
});

test('the front of the paper is not added twice', () => {
  // A first heading at the very top of page one is the start already.
  const topped = [{ ...outline[0], y: 1 }, outline[1]];
  assert.deepEqual(sectionStops(topped, 4).map(stopName), ['1 Introduction', '2 Method']);
  // And Abstract is the author's own name for the front.
  const abstracted = [{ id: 'a', level: 0, title: 'Abstract', page: 1, y: 0.6 }, outline[1]];
  assert.deepEqual(sectionStops(abstracted, 4).map(stopName), ['Abstract', '2 Method']);
});

test('the sections are whichever level of the outline holds more than one entry', () => {
  const filed = [
    { id: 't', level: 0, title: 'The whole paper', page: 1, y: 1 },
    { id: 'a', level: 1, title: 'One', page: 1, y: 0.5 },
    { id: 'b', level: 1, title: 'Two', page: 2, y: 0.5 },
  ];
  assert.deepEqual(sectionStops(filed, 3).map(stopName), ['Start', 'One', 'Two']);
});

test('a section past the end of the paper, or a paper with no pages, is not a stop', () => {
  assert.deepEqual(sectionStops([{ id: 'x', level: 0, title: 'Beyond', page: 9, y: 0.5 }], 4), []);
  assert.deepEqual(sectionStops(outline, 0), []);
  assert.deepEqual(sectionStops([], 4), []);
});

test('a paper without sections stops at every page', () => {
  const stops = pageStops(3);
  assert.deepEqual(stops.map(stopName), ['1', '2', '3']);
  assert.deepEqual(stops.map((stop) => [stop.page, stop.at, stop.span]), [[1, 0, 1], [2, 1, 1], [3, 2, 1]]);
  assert.deepEqual(pageStops(0), []);
});

test('a place in the paper is in the last stop that begins before it', () => {
  const stops = sectionStops(outline, 4);
  assert.equal(stopAt(stops, 0), 0);
  assert.equal(stopAt(stops, 0.29), 0);
  assert.equal(stopAt(stops, 0.31), 1);
  assert.equal(stopAt(stops, stops[1].at), 1);
  assert.equal(stopAt(stops, 1.5), 2);
  assert.equal(stopAt(stops, 2.6), 3);
  assert.equal(stopAt(stops, 4), 4);
  // Before the first stop is still in it: the paper has nowhere else to be.
  const late = sectionStops([outline[1], outline[3]], 4).slice(1);
  assert.equal(stopAt(late, 0.5), 0);
  assert.equal(stopAt([], 1), -1);
});
