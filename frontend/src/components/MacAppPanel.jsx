import React from 'react';
import { MAC_DOWNLOAD_URL } from '../../../shared/macDownload.js';

// Where a member finds Papol for Mac once the banner announcing it has been
// closed: its own tab on their page, so it is never more than a click away.
export default function MacAppPanel() {
  return (
    <div className="preferences-panel">
      <section className="panel preferences-block" aria-labelledby="mac-app-title">
        <h2 className="panel-title" id="mac-app-title">Papol for Mac</h2>
        <div className="local-setting-row preferences-row">
          <p className="preferences-mac-note">
            <strong>Papol as a Mac app. Your papers are available offline.</strong>
            <span>For Macs with Apple silicon.</span>
          </p>
          <a className="button preferences-mac-download" href={MAC_DOWNLOAD_URL}>Download</a>
        </div>
      </section>
    </div>
  );
}
