// A paper on Papol's public file host needs no session credential. Sending
// one makes the browser require Access-Control-Allow-Credentials, which a
// public R2 response deliberately does not carry. Same-origin deployments
// may still serve PDFs through the authenticated application origin.
export function pdfFetchCredentials(href, origin = window.location.origin) {
  return new URL(href, origin).origin === origin ? 'include' : 'omit';
}
