import React, { useEffect, useRef, useState } from 'react';
import DeskFileDropFeedback from '../../shared/ui/FileDropFeedback.jsx';
import { carriesFiles, deskFileDragState, isPdfFile } from '../../shared/fileDrop.js';
import { handOverDroppedPdfs } from '../../shared/droppedPapers.js';
import { getToken } from './api.js';
import { DESKTOP } from '../../shared/desktopShell';
import { appPath } from './base';

// PDFs dropped while reading, on the web, are papers to add, as they are on
// every Desk page: they go to the nook's upload, which takes them in. The
// browser is never left to open a dropped PDF in Papol's place.
export default function PaperDrop() {
  const [drag, setDrag] = useState(null);
  const [notice, setNotice] = useState(null);
  const depth = useRef(0);
  const noticeTimer = useRef(null);

  useEffect(() => {
    if (DESKTOP) return undefined;
    const member = () => Boolean(getToken());
    const say = (message) => {
      setNotice(message);
      window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setNotice(null), 4000);
    };
    const enter = (event) => {
      if (!carriesFiles(event.dataTransfer) || event.defaultPrevented) return;
      event.preventDefault();
      if (!member()) return;
      depth.current += 1;
      setDrag(deskFileDragState(event.dataTransfer));
    };
    const over = (event) => {
      if (!carriesFiles(event.dataTransfer) || event.defaultPrevented) return;
      event.preventDefault();
      const state = member() ? deskFileDragState(event.dataTransfer) : 'reject';
      event.dataTransfer.dropEffect = state === 'reject' ? 'none' : 'copy';
      if (member()) setDrag(state);
    };
    const leave = (event) => {
      if (!carriesFiles(event.dataTransfer)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDrag(null);
    };
    const drop = async (event) => {
      if (!carriesFiles(event.dataTransfer)) return;
      depth.current = 0;
      setDrag(null);
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (!member()) return;
      const pdfs = Array.from(event.dataTransfer.files || []).filter(isPdfFile);
      if (!pdfs.length) {
        say('Papol’s Desk only supports PDF files.');
        return;
      }
      if (!(await handOverDroppedPdfs(pdfs))) {
        say('This browser could not hold the PDF. Add it from your nook.');
        return;
      }
      window.location.assign(appPath('/'));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.clearTimeout(noticeTimer.current);
    };
  }, []);

  return <DeskFileDropFeedback state={drag} message={notice} folders={false} />;
}
