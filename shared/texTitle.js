// Titles that carry TeX.
//
// A paper's title comes from its metadata, and metadata written by people who
// write LaTeX keeps their math: "$$\mathsf {CoreFun}$$: A Typed Functional
// Reversible Core Language". Where a title is drawn, the math is typeset
// (PaperTitle); everywhere a title is plain text — the tab title, a drag, a
// label read aloud, a search — it reads as the words a person would say.

// $$…$$, $…$ and \(…\). A dollar written \$ is a dollar, and so is one that
// cannot open or close math the way TeX writers do ("$5 to $10"): an opening
// $ is not followed by a space, a closing one is not preceded by a space nor
// followed by a digit.
const MATH = /\$\$([\s\S]+?)\$\$|(?<!\\)\$(?!\s)((?:\\\$|[^$])+?)(?<!\s)\$(?!\d)|\\\(([\s\S]+?)\\\)/g;

// The title as runs of text and math, in order.
export function titleParts(title) {
  const text = String(title ?? '');
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(MATH)) {
    const tex = match[1] ?? match[2] ?? match[3];
    if (!tex.trim()) continue;
    if (match.index > last) parts.push({ text: unescape(text.slice(last, match.index)) });
    parts.push({ tex: tex.trim() });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: unescape(text.slice(last)) });
  return parts;
}

export const hasTex = (title) => titleParts(title).some((part) => part.tex);

const unescape = (text) => text.replace(/\\\$/g, '$');

const SYMBOLS = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
  rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  times: '×', cdot: '·', to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒',
  mapsto: '↦', infty: '∞', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', sim: '∼',
  in: '∈', subseteq: '⊆', subset: '⊂', cup: '∪', cap: '∩', forall: '∀', exists: '∃', neg: '¬', lnot: '¬',
  wedge: '∧', land: '∧', vee: '∨', lor: '∨', oplus: '⊕', otimes: '⊗', circ: '∘', partial: '∂', nabla: '∇',
  sum: '∑', prod: '∏', int: '∫', emptyset: '∅', varnothing: '∅', pm: '±', ldots: '…', dots: '…', cdots: '⋯',
  langle: '⟨', rangle: '⟩', vdash: '⊢', models: '⊨', top: '⊤', bot: '⊥', star: '⋆', ell: 'ℓ',
  mathbb: '', mathcal: '', mathsf: '', mathrm: '', mathit: '', mathbf: '', mathtt: '', mathfrak: '',
  textsf: '', textrm: '', textit: '', textbf: '', texttt: '', text: '', operatorname: '', boldsymbol: '',
  left: '', right: '', big: '', Big: '', bigl: '', bigr: '', displaystyle: '', textstyle: '',
};

// Math as the characters it would be read as: \mathsf{CoreFun} is CoreFun,
// \lambda is λ, x^{2} is x2.
export function plainTex(tex) {
  return tex
    .replace(/\\([A-Za-z]+)\s*(?=\{)|\\([A-Za-z]+)/g, (_, a, b) => SYMBOLS[a ?? b] ?? a ?? b)
    .replace(/\\([,;:! ])/g, ' ')
    .replace(/\\(.)/g, '$1')
    .replace(/[{}^_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// The title as plain text, with its math read out.
export function plainTitle(title) {
  if (title == null) return title;
  return titleParts(title)
    .map((part) => (part.tex ? plainTex(part.tex) : part.text))
    .join('');
}
