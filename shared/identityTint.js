// A user keeps one colour: their UUID, folded to one of the --identity-*
// tokens (designTokens.js). The avatar wears it as a background; the
// viewer, with a project on, draws their ink in its brighter sibling.
export const IDENTITY_TINTS = 6;

export const tintOf = (user) => [...user.uuid]
  .reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) % 65521, 0) % IDENTITY_TINTS;
