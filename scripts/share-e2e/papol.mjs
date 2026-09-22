// What the browser suites share: the Worker's API as a script calls it,
// and a PDF made for one run.

import { createHash } from 'node:crypto';

export const BASE = (process.env.PAPOL_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '');
const PASSWORD = 'papol-test-pw';

export async function call(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(BASE + path, {
      method,
      headers,
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  } catch (error) {
    console.error(`No Papol at ${BASE} (${error.cause?.code || error.message}). Start one with ./deploy.sh dev`);
    process.exit(2);
  }
  const text = await response.text();
  return [response.status, text.trim() ? JSON.parse(text) : null];
}

// Register, or sign in if this run has been made before.
export async function account(email, name) {
  let [status, out] = await call('POST', '/api/auth/register', {
    body: { email, display_name: name, password: PASSWORD },
  });
  if (status !== 200) {
    [status, out] = await call('POST', '/api/auth/login', { body: { email, password: PASSWORD } });
    if (status !== 200) throw new Error(`could not sign ${email} in: ${JSON.stringify(out)}`);
  }
  return { token: out.token, uuid: out.user.uuid, name: out.user.display_name };
}

// A PDF into the bucket under its digest, by the address the Worker gives
// (its own door, on a local one). Answers the address, whose `file_path`
// names the stored file.
export async function storePdf(token, pdf, name) {
  const digest = createHash('sha256').update(pdf).digest('hex');
  const [status, address] = await call('POST', '/api/files/upload-address', {
    token, body: { kind: 'paper', sha256: digest, size: pdf.length, name },
  });
  if (status !== 200) throw new Error(`could not get an address for the PDF: ${JSON.stringify(address)}`);
  if (!address.stored) {
    const put = await fetch(/^https?:/.test(address.url) ? address.url : BASE + address.url, { method: 'PUT', headers: address.headers, body: pdf });
    if (!put.ok) throw new Error(`could not store the PDF: the bucket answered ${put.status}`);
  }
  return address;
}

// One page with this run's suffix printed on it. New words are new bytes,
// and the digest of the bytes is the paper's identity — which is what makes
// the paper genuinely new each run rather than a reused one.
export function freshPdf(text) {
  const stream = `BT /F1 18 Tf 72 720 Td (${text.replace(/[\\()]/g, (c) => `\\${c}`)}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
