// The one fact about the brush that more than one file needs to know.
//
// A flat nib is three times as tall as it is wide, and that ratio is used
// in three places — the nib the page draws under the pointer, the swept
// outline a stroke leaves, and the sample in the brush's sheet. If they
// disagreed the user would be shown one shape and handed another.
export const STRIP_RATIO = 3;
