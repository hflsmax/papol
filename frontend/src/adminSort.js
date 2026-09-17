// Ordering for the admin database panel, where a column holds whatever the
// database holds: numbers, ISO timestamps, booleans, text, and nulls, all in
// the same column. The rules here are the ones a person reading a table
// expects — numbers count up, text reads alphabetically, and blanks sit at
// the bottom whichever way the column is pointed.

// Clicking a header walks asc → desc → off. The third click matters: rows
// arrive in the table's own order, and that order is information the panel
// cannot fetch again without reloading the table.
export function nextSortDirection(direction) {
  if (direction === 'asc') return 'desc';
  if (direction === 'desc') return null;
  return 'asc';
}

// A header click on a different column starts that column fresh at ascending.
export function nextSort(sort, column) {
  if (sort?.column !== column) return { column, direction: 'asc' };
  const direction = nextSortDirection(sort.direction);
  return direction ? { column, direction } : null;
}

const isBlank = (value) => value === null || value === undefined || value === '';

// A string is only read as a number when the whole of it is one, so that
// "2024-01-02" stays a date and "10 papers" stays text.
const asNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const text = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Compares two cell values, ignoring direction; blanks are handled by the
// caller because they are pinned last rather than flipped.
export function compareValues(a, b) {
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return Number(Boolean(a)) - Number(Boolean(b));
  }
  const left = asNumber(a);
  const right = asNumber(b);
  if (left !== null && right !== null) return left - right;
  return text.compare(String(a), String(b));
}

// Returns a new array: the panel keeps the rows it was given so that turning
// the sort off restores the table's own order. Ties keep the order they had,
// which JavaScript's sort guarantees.
export function sortRows(rows, sort) {
  if (!sort?.column || !sort?.direction) return rows;
  const sign = sort.direction === 'desc' ? -1 : 1;
  return [...rows].sort((rowA, rowB) => {
    const a = rowA[sort.column];
    const b = rowB[sort.column];
    if (isBlank(a) && isBlank(b)) return 0;
    if (isBlank(a)) return 1;
    if (isBlank(b)) return -1;
    return sign * compareValues(a, b);
  });
}

// What a screen reader announces for the column, and what the arrow shows.
export function sortIndicator(sort, column) {
  if (sort?.column !== column) return { ariaSort: 'none', arrow: '' };
  return sort.direction === 'desc'
    ? { ariaSort: 'descending', arrow: '↓' }
    : { ariaSort: 'ascending', arrow: '↑' };
}
