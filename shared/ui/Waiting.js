// One way to wait (docs/waiting.md).
//
// Every wait in Papol is one of two things. `Progress` is a wait that can
// be measured: a thin bar, its label on the left and its numbers on the
// right. `Working` is a wait that cannot: the one spinner, and a label.
// Neither is modal, and each sits exactly where its result will appear.
//
// Written with createElement rather than JSX so the unit tests can render
// the components under plain Node, which reads no JSX.

import { createElement as h } from 'react';

// An unmeasured wait: the spinner, then a word or two. Reads itself out
// politely; the label changes as the stage does.
export function Working({ label = 'Please wait…', className }) {
  return h(
    'div',
    { className: className ? `wait wait-working ${className}` : 'wait wait-working', role: 'status', 'aria-live': 'polite' },
    h('span', { className: 'spinner', 'aria-hidden': 'true' }),
    label ? h('span', { className: 'wait-label' }, label) : null,
  );
}

// A measured wait. `fraction` runs from 0 to 1; `label` is a word or two
// ("Uploading"); `detail` is the numbers, made by formatProgressDetail in
// shared/waiting.js ("12 MB of 30 MB"). A bar never animates without a
// total: with no fraction to show, this renders `Working` instead, so a
// caller that loses its measure mid-way falls back rather than lying.
export function Progress({ fraction, label, detail, className }) {
  if (fraction == null || !Number.isFinite(fraction)) {
    return h(Working, { label: label && !/…$/.test(label) ? `${label}…` : label, className });
  }
  const clamped = Math.max(0, Math.min(1, fraction));
  const percent = Math.round(clamped * 100);
  return h(
    'div',
    {
      className: className ? `wait wait-progress ${className}` : 'wait wait-progress',
      role: 'progressbar',
      'aria-label': label,
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': percent,
      'aria-valuetext': detail || `${percent}%`,
    },
    h(
      'div',
      { className: 'wait-text' },
      h('span', { className: 'wait-label' }, label),
      detail ? h('span', { className: 'wait-detail' }, detail) : null,
    ),
    h(
      'div',
      { className: 'wait-track', 'aria-hidden': 'true' },
      h('div', { className: 'wait-fill', style: { width: `${clamped * 100}%` } }),
    ),
  );
}
