import emojis from '../config/reactions.json' with { type: 'json' };

// The common emoji the picker offers first, in the order it shows them.
// Every other emoji is behind More (allEmojis.js); the server takes any.
export default emojis;
