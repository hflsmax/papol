// The least and most of many numbers. Math.min(...xs) passes every number
// as an argument, and a page that paints tens of thousands of paths
// overflows the stack that way.

export function least(xs: number[]): number {
  let m = Infinity;
  for (const x of xs) if (x < m) m = x;
  return m;
}

export function most(xs: number[]): number {
  let m = -Infinity;
  for (const x of xs) if (x > m) m = x;
  return m;
}
