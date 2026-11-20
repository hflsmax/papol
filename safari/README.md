# Papol for Safari

Every PDF you open in Safari opens in Papol's viewer instead of Safari's
own, where you can read it, add it to your nook, and annotate it once it is
there. It is a Safari Web Extension: the standard WebExtension API, in
`extension/`, wrapped in a small macOS app that Xcode generates.

## What it does

1. **Sends PDFs to Papol.** A top-level navigation to a PDF goes to
   `https://papol.io/viewer/?from=<the PDF's address>` instead. A PDF is
   known by its address before it loads (a `.pdf` name, or a site that
   serves PDFs without one: arXiv, OpenReview, ACM, Springer; see
   `extension/policy.js`), or by its content type once Safari starts showing
   it (`extension/detect.js`). PDFs inside frames are left alone, and so are
   Papol's own PDFs.
2. **Fetches the PDF for the viewer, as you.** Papol's page cannot read
   another site's PDF, and often should not try: the PDF may need your
   publisher sign-in or your campus network. So the extension's script on
   Papol's viewer (`extension/bridge.js`) asks the background, which fetches
   the bytes with your cookies and hands them to the page. Nothing is sent
   to Papol's servers by opening a PDF. It only fetches PDFs it sent to Papol
   itself in the last six hours, and only for the Papol address you chose,
   so no page can use it to read anything else you can reach.
3. **Lets you go back to Safari's viewer.** "Original" in Papol's bar, or
   the Back button, shows the PDF as it is; the extension lets a PDF through
   in the tab where Papol's viewer just showed it.

The toolbar button switches the automatic opening off and on, opens the PDF
in front of you in Papol when the rules missed it, and (under "Papol
address") points the extension at `dev.papol.io` or a local
`./deploy.sh dev` on `127.0.0.1:5173`.

In the viewer (`viewer/src/fetchedPdf.js`, `fetchedSource` in
`viewer/src/source.js`) the PDF is an opened file, as one opened from disk
is in Papol for Mac: readable by anyone, nothing on it yours until you add
it. **Add to nook** asks a signed-out reader to sign in, brings them back to
the same PDF, and adds it; it goes up as an upload does, onto the default
shelf with what the reading found, and the window moves to the paper's
ordinary viewer. A PDF you already keep goes straight there.

## Try it

On a Mac with Safari 18 or later, without building anything:

1. Safari > Settings > Advanced: turn on "Show features for web developers".
2. Safari > Settings > Developer: "Add Temporary Extension…", and choose
   `safari/extension`. It stays until Safari quits.
3. Allow it on every website when Safari asks (the toolbar button, or
   Safari > Settings > Extensions).

To build the app that installs it for good:

    safari/scripts/make-xcode.sh

then open the generated project in Xcode, run "Papol for Safari" once, and
turn the extension on in Safari > Settings > Extensions. An unsigned build
needs Safari > Settings > Developer > "Allow unsigned extensions".

## Tests

    node --test safari/policy.test.mjs

The extension also runs unchanged in Chrome (`chrome.*` stands in for
`browser.*`), which is how it was driven end to end: load `safari/extension`
unpacked, choose `127.0.0.1:5173` under "Papol address", and open a PDF.

## Not built yet

- It ships as its own app, not inside Papol for Mac. Embedding the
  extension in the Tauri app means building the `.appex` with Xcode and
  copying it into `Papol.app/Contents/PlugIns` before signing.
- On the Mac with Papol for Mac installed, the PDF still opens in the web
  viewer; handing it to the app instead is a later step.
- A PDF that only a POST answers (some publisher "download" forms) is fetched
  again with a GET, which may not get it; "Original" shows it as before.
