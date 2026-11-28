import emojis from '../config/emoji.json' with { type: 'json' };

// Every emoji, in groups: [{ name, emojis: [[emoji, name], …] }]. Fetched
// through allEmojis.js, never with the page.
export default emojis;
