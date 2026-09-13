import { LineCapStyle, PDFDocument, PDFHexString, rgb } from 'pdf-lib';

// A copy of the PDF that carries the reader's marks with it: ink drawn into
// the page, and each located note as a standard comment another PDF reader
// can open. Coordinates are fractions of the page, y from the bottom — the
// same space the viewer stores them in.

function colorOf(hex) {
  const value = Number.parseInt(String(hex || '#b3923d').slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => channel / 255);
}

export async function annotatePdf(bytes, { notes = [], ink = [] } = {}) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = pdf.getPages();

  for (const stroke of ink) {
    const page = pages[stroke.page - 1];
    if (!page || !stroke.points?.length) continue;
    const { x, y, width, height } = page.getCropBox();
    const path = stroke.points
      .map((point, index) => `${index ? 'L' : 'M'}${(point.x * width).toFixed(2)} ${((1 - point.y) * height).toFixed(2)}`)
      .join(' ');
    page.drawSvgPath(stroke.points.length === 1 ? `${path} l0.01 0` : path, {
      x,
      y: y + height,
      borderColor: rgb(...colorOf(stroke.color)),
      borderWidth: Math.max(0.25, (stroke.width || 0.004) * width),
      borderOpacity: stroke.opacity ?? 1,
      borderLineCap: LineCapStyle.Round,
    });
  }

  for (const note of notes) {
    const page = pages[note.page - 1];
    if (!page || !note.anchor) continue;
    const { x, y, width, height } = page.getCropBox();
    const left = x + note.anchor.x * width;
    const top = y + note.anchor.y * height;
    const comment = pdf.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [left, top - 18, left + 18, top],
      Contents: PDFHexString.fromText(note.content || note.name || ''),
      T: PDFHexString.fromText(note.name || `Page ${note.page}`),
      Name: 'Comment',
      C: colorOf('#b3923d'),
      F: 4,
    });
    page.node.addAnnot(pdf.context.register(comment));
  }

  return pdf.save();
}
