import React from 'react';
import { appPath } from '../base';

export default function BackLink({ href, onBack, children = <>&larr; Back</>, ...props }) {
  return <a href={href || appPath('/')} onClick={(event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onBack?.();
  }} {...props}>{children}</a>;
}
