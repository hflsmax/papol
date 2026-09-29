import React from 'react';
import Avatar from '../../shared/ui/Avatar.jsx';
import ItemActions from '../../shared/ui/ItemActions.jsx';
import { TalkPin } from '../../shared/ui/Talk.jsx';
import { memberInk } from './project.js';

// Any annotation the reader can see can hold a dig — the project's with a
// project on, else the reader's own. Never one still being saved, which
// has no name yet. `digs` is what the viewer knows of them (App's
// pageProject): whose, the pins, and where a press should open.
const diggable = (digs, annotation) => Boolean(digs) && typeof annotation.uuid === 'string' && !annotation.uuid.startsWith('wet-');

export function DigPin({ digs, annotation, label, startOpen = false }) {
  if (!diggable(digs, annotation)) return null;
  return (
    <TalkPin
      projectUuid={digs.uuid}
      subject={{ annotation: annotation.uuid }}
      label={label}
      summary={digs.digs[annotation.uuid]}
      currentUser={digs.me}
      onChanged={digs.onDigChanged}
      size="sm"
      openOn={digs.landing?.annotation === annotation.uuid ? digs.landing.dig : null}
      startOpen={startOpen}
      onPress={digs.inMargin?.(annotation.uuid)}
    />
  );
}

// The bar over an anchor, ink or clip picked out: one bar the same for all
// three. Whose it is, when it is another member's; then the dig, always
// first and always the spade; then what else can be done to it.
export default function ThingBar({ digs, annotation, label, actions = [], actionsLabel, startOpen = false, className = '', style }) {
  const dig = diggable(digs, annotation) && <DigPin digs={digs} annotation={annotation} label={label} startOpen={startOpen} />;
  const who = annotation.theirs ? annotation.user : null;
  if (!dig && !who && !actions.length) return null;
  const stop = (event) => event.stopPropagation();
  return (
    <span
      className={`thing-bar${className ? ` ${className}` : ''}`}
      style={{ ...style, ...(who ? { '--who': memberInk(who) } : {}) }}
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      {who && (
        <span className="thing-who">
          <Avatar user={who} className="mini-avatar" />
          <span>{who.display_name}</span>
        </span>
      )}
      {dig && <span className="thing-dig">{dig}</span>}
      {actions.length > 0 && <ItemActions label={actionsLabel} placement="above-end" actions={actions} />}
    </span>
  );
}
