// Every emoji, in the groups and the order the Unicode standard lists
// them, each with its name: what the picker shows behind More. It is
// some fifty kilobytes, so it is fetched when More is first pressed and
// not with the page. Generated from the unicode-emoji-json package (MIT),
// up to Emoji 15.0, without the skin-tone variants.
let asked = null;

export function allEmojis() {
  asked ??= import('./allEmojiData.js').then((found) => found.default);
  return asked;
}
