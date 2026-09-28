// KaTeX, fetched the first time a title with math is drawn. Most titles have
// none, so most pages never load it.
import katex from 'katex';
import 'katex/dist/katex.min.css';
import './texMath.css';

export function texHtml(tex) {
  try {
    return katex.renderToString(tex, { throwOnError: true, strict: 'ignore' });
  } catch {
    return null;
  }
}
