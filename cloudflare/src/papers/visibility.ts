// Who sees what of a copy.
//
// The shelf says whether a copy is on display at all. Within a copy on
// display, each of four fields answers for itself: the thought, the
// ratings, the summary and the tags. A new copy starts as every copy did
// before the fields had a say — thought and ratings shown, summary and
// tags kept.

import { type Row } from "../db";

export const FIELD_VISIBILITY = ["thought_public", "ratings_public", "summary_public", "tags_public"] as const;

export const NEW_COPY_VISIBILITY = { thought_public: 1, ratings_public: 1, summary_public: 0, tags_public: 0 };

// The fields of a copy on display that its user has let be seen. A field
// kept back is null, as though it had never been written: nobody else can
// tell a private rating from no rating.
export function shownFields(copy: Row) {
  const ratings = Boolean(copy.ratings_public);
  return {
    thought: copy.thought_public ? (copy.thought as string | null) ?? null : null,
    rating_expertise: ratings ? (copy.rating_expertise as number | null) ?? null : null,
    rating_reading: ratings ? (copy.rating_reading as number | null) ?? null : null,
    rating_liking: ratings ? (copy.rating_liking as number | null) ?? null : null,
    summary: copy.summary_public ? (copy.summary as string | null) ?? null : null,
  };
}

// The four settings as the owner's own paper states them.
export function visibilityOut(copy: Row) {
  return Object.fromEntries(FIELD_VISIBILITY.map((field) => [field, Boolean(copy[field])])) as Record<(typeof FIELD_VISIBILITY)[number], boolean>;
}
