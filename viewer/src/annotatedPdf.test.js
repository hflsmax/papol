import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { annotatePdf } from './annotatedPdf.js';

async function blankPdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 100]);
  pdf.addPage([200, 100]);
  return pdf.save();
}

test('ink is drawn into its page and notes become PDF comments', async () => {
  const original = await blankPdf();
  const annotated = await annotatePdf(original, {
    ink: [{ page: 2, points: [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.6 }], color: '#ff0000', width: 0.01, opacity: 0.5 }],
    notes: [
      { page: 1, anchor: { type: 'point', x: 0.25, y: 0.75 }, content: 'Check this bound', name: null },
      { page: 1, anchor: null, content: 'Not on the page' },
    ],
  });

  const pdf = await PDFDocument.load(annotated);
  const [first, second] = pdf.getPages();
  const annots = first.node.lookup(PDFName.of('Annots'), PDFArray);
  assert.equal(annots.size(), 1);
  const comment = annots.lookup(0);
  assert.equal(comment.lookup(PDFName.of('Subtype')).asString(), '/Text');
  assert.equal(comment.lookup(PDFName.of('Contents'), PDFHexString).decodeText(), 'Check this bound');
  const [left, bottom] = comment.lookup(PDFName.of('Rect'), PDFArray).asArray().map((n) => n.asNumber());
  assert.deepEqual([left, bottom + 18], [50, 75]);
  assert.equal(second.node.Annots()?.size() ?? 0, 0);
  assert.ok(second.node.Contents(), 'the stroke is drawn into the second page');
});
