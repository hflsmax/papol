import React from 'react';

export const RATING_DIMENSIONS = [
  { key: 'rating_expertise', label: 'My expertise', hint: 'How much of an expert are you on this topic?' },
  { key: 'rating_reading', label: 'Reading depth', hint: 'How closely did you read the paper?' },
  { key: 'rating_liking', label: 'Merit', hint: 'How much merit do you see in the paper?' },
];

export function RatingDots({ value }) {
  if (!value) {
    return <span className="rating-none" title="The reader chose not to rate this">not rated</span>;
  }
  return (
    <span className="rating-dots" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= value ? 'dot filled' : 'dot'}>
          {i <= value ? '●' : '○'}
        </span>
      ))}
    </span>
  );
}

export function RatingSummary({ paper, compact = false }) {
  const rated = RATING_DIMENSIONS.filter((d) => paper[d.key]);
  // In compact list rows, omit unrated dimensions to keep rows tidy;
  // on the paper page, show all three so the "not rated" choice is visible.
  const dims = compact ? rated : RATING_DIMENSIONS;
  if (dims.length === 0) return null;
  return (
    <div className={compact ? 'rating-summary compact' : 'rating-summary'}>
      {dims.map((d) => (
        <span key={d.key} className="rating-item" title={d.hint}>
          <span className="rating-label">{d.label}</span>
          <RatingDots value={paper[d.key]} />
        </span>
      ))}
    </div>
  );
}

export function RatingInput({ values, onChange }) {
  return (
    <div className="rating-inputs">
      {RATING_DIMENSIONS.map((d) => (
        <div key={d.key} className="rating-input-row">
          <label title={d.hint}>{d.label}</label>
          <div className="rating-buttons" role="radiogroup" aria-label={d.label}>
            {[1, 2, 3, 4, 5].map((i) => (
              <button
                key={i}
                type="button"
                className={values[d.key] === i ? 'rating-btn selected' : 'rating-btn'}
                onClick={() => onChange(d.key, values[d.key] === i ? null : i)}
                aria-pressed={values[d.key] === i}
              >
                {i}
              </button>
            ))}
            <span className="rating-tail">
              {values[d.key] ? (
                <button
                  type="button"
                  className="rating-clear"
                  onClick={() => onChange(d.key, null)}
                  title="Don't show a rating for this"
                >
                  clear
                </button>
              ) : (
                <span className="rating-none">not rated</span>
              )}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
