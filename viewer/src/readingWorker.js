import { analyzePages } from '../../analyzer/src/rules/paper.ts';

// The analyzer's rules, off the page's own thread: laying out a whole paper
// and finding its references, citations, figures and headings is the one
// stretch of the work that cannot be broken into idle moments, and here it
// holds up nothing the reader can see.
self.onmessage = (event) => {
  try {
    self.postMessage(analyzePages(event.data.pages));
  } catch (error) {
    self.postMessage({ error: String(error?.message || error) });
  }
};
