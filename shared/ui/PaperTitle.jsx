import { useEffect, useState } from 'react';
import { plainTex, titleParts } from '../texTitle.js';

let loaded = null;
let loading = null;
const loadTex = () => (loading ??= import('./texMath.js').then((module) => { loaded = module; return module; }));

// A title as it is read: its TeX typeset, the rest as text. Until KaTeX has
// arrived, and wherever a formula will not typeset, the math reads as plain
// text, so the title never shows its dollar signs.
export default function PaperTitle({ title }) {
  const parts = titleParts(title);
  const math = parts.some((part) => part.tex);
  const [tex, setTex] = useState(loaded);
  useEffect(() => {
    if (!math || tex) return undefined;
    let live = true;
    loadTex().then((module) => { if (live) setTex(module); }, () => {});
    return () => { live = false; };
  }, [math, tex]);
  if (!math) return title ?? null;
  return parts.map((part, index) => {
    if (!part.tex) return part.text;
    const html = tex?.texHtml(part.tex);
    return html
      ? <span key={index} className="tex-math" dangerouslySetInnerHTML={{ __html: html }} />
      : plainTex(part.tex);
  });
}
