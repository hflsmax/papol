// The one fact about the brush that more than one file needs to know.
//
// A flat nib is three times as tall as it is wide, and that ratio is used
// in three places — the nib the page draws under the pointer, the swept
// outline a stroke leaves, and the sample in the brush's sheet. If they
// disagreed the reader would be shown one shape and handed another.
//
// This file once also worked out how many pixels a stroke came to, for a
// cursor image that had to be sized in advance. The brush is drawn on the
// page now, in the stroke's own coordinates, so nothing has to be worked
// out ahead of time and the rest of that has gone.
export const STRIP_RATIO = 3;
