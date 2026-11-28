import React, { useContext, useState, useEffect, useRef } from 'react';
import { Progress, Working } from '../../../shared/ui/Waiting.js';
import {
  getPaper, updatePaper, deletePaper, createTag, listTags, listShelves,
  addToNook, pdfFileName, pdfHref, reextractPaperMetadata,
} from '../../../shared/api/papers.js';
import { useDismiss } from '../../../shared/useDismiss.js';
import {
  createSharable, leanSharable, revokeSharable, sharableHref,
} from '../../../shared/api/sharables.js';
import { copyText, nativeBlobUrl, nativeDataActive } from '../../../shared/nativeData.js';
import { paperName } from '../../../shared/paperName.js';
import { InWay, WayShown } from './Way';
import { readPrintedAt } from '../pdfIdentifier.js';
import HintPop from './HintPop';
import Avatar from './Avatar';
import { RatingInput } from './Rating';
import ReaderPop from './ReaderPop';
import ProjectPicker from './ProjectPicker';
import VisibilityChip from './VisibilityChip';
import Markdown, { MarkdownHint } from './Markdown';
import MarkdownField from '../../../shared/ui/MarkdownField.jsx';
import appLimits from '../../../shared/appLimits.js';
import AutoTextarea from './AutoTextarea';
import { authorList } from '../paperFormat';
import { applyChanges, foundFields, metadataCandidates, metadataChanges } from '../metadataReview.js';
import { appPath } from '../base';
import BackLink from '../../../shared/ui/BackLink.jsx';
import { confirmAction } from '../../../shared/confirmAction';
import { VISIBILITY_TIP, isFeatureStateSet, setFeatureState } from '../../../shared/featureStates.js';
import PaperTitle from '../../../shared/ui/PaperTitle.jsx';
import { TalkCard } from '../../../shared/ui/Talk.jsx';
import { friendDigsOn } from '../../../shared/api/friends.js';
import { relationTo, useFriends } from '../friendsStore';
import PinButton from './PinButton';

// What a friend's dig is about, at its head: the whole paper, or a place
// in it. A place opens the paper on its page, as far down as the mark
// sits; the mark itself is its writer's and is not drawn for anyone else.
function FriendDigFocus({ dig, paper }) {
  const { kind, page, down, annotation_kind: mark } = dig.subject;
  if (kind !== 'annotation' || !page) {
    return <p className="friend-dig-focus"><span className="friend-dig-focus-on">On the whole paper</span></p>;
  }
  const what = mark === 'ink' ? 'painted text' : mark === 'clip' ? 'a clip' : 'an anchor';
  const place = appPath(`/viewer/?pdf=${paper.sha256}&page=${page}${down == null ? '' : `&y=${Math.round(down * 1000) / 1000}`}`);
  return (
    <p className="friend-dig-focus">
      <a className="friend-dig-focus-on" href={place} data-document title={`Open the paper on page ${page}`}>
        On page {page}
      </a>
      <span className="friend-dig-focus-what">at {what}</span>
    </p>
  );
}

export default function PaperJacket({
  paperSha256, currentUser, onBack, backHref, onSelectPaper, onChanged, onRead,
  onDeleted, hideBack = false, backLabel = 'Back', onReportableError,
}) {
  // Under the bar the paper's title, authors and venue stand on it.
  const inBar = useContext(WayShown);
  const [paper, setPaper] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editMode, setEditMode] = useState(null); // null | 'metadata' | 'summary'
  const [tagDraft, setTagDraft] = useState('');
  const [availableTags, setAvailableTags] = useState([]);
  const [shelves, setShelves] = useState([]);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [editData, setEditData] = useState({});
  const [error, setError] = useState(null);
  // What my friends dug on this paper and on their marks in it, each while
  // they keep it on a public shelf. Friends stand first among its readers.
  const [friendDigs, setFriendDigs] = useState([]);
  const friends = useFriends(Boolean(currentUser));
  const isFriend = (uuid) => relationTo(friends, uuid) === 'friend';
  useEffect(() => {
    setFriendDigs([]);
    if (!currentUser) return undefined;
    let active = true;
    friendDigsOn(paperName(paperSha256))
      .then((found) => { if (active) setFriendDigs(found.digs ?? []); })
      .catch(() => {})
      .finally(() => { if (active) setDigsRead(paperSha256); });
    return () => { active = false; };
  }, [paperSha256, currentUser?.uuid, friends?.friends.length]);
  // A link from the inbox or an email names one dig (#dig-<uuid>): once the
  // friends' digs are in, the jacket goes to it, a friend's by its own row
  // and otherwise mine, and marks it for a moment.
  const [digsRead, setDigsRead] = useState(null);
  useEffect(() => {
    const named = window.location.hash.match(/^#dig-([0-9a-f-]{36})$/i)?.[1];
    if (!named || digsRead !== paperSha256) return undefined;
    const at = document.getElementById(`dig-${named.toLowerCase()}`) ?? document.getElementById('your-dig');
    if (!at) return undefined;
    // The digs above it are still filling with their posts, which moves
    // it down the page: it is gone to again as they settle.
    const go = () => at.scrollIntoView({ block: 'center' });
    go();
    at.classList.add('is-pointed');
    const again = [300, 900].map((after) => setTimeout(go, after));
    const done = setTimeout(() => at.classList.remove('is-pointed'), 3000);
    return () => { [...again, done].forEach(clearTimeout); at.classList.remove('is-pointed'); };
  }, [digsRead, paperSha256]);
  const [isAddingToNook, setIsAddingToNook] = useState(false);
  const [isExtractingMetadata, setIsExtractingMetadata] = useState(false);
  const [metadataExtractStatus, setMetadataExtractStatus] = useState('Reading PDF…');
  // What the reading found, offered for the user to take field by field
  // (metadataReview.js): `{ candidates, which, chosen }`, or null.
  const [metadataFound, setMetadataFound] = useState(null);
  const [toggleWarning, setToggleWarning] = useState(null);
  const [editingThought, setEditingThought] = useState(false);
  const [thoughtDraft, setThoughtDraft] = useState('');
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  // Which link was last copied, and how it went. One state for the link
  // wherever it is shown — in the menu, and in the bar below — so a
  // "Copied!" never appears on the wrong one.
  const [shareCopied, setShareCopied] = useState({ target: null, status: 'idle' });
  const [shareOpen, setShareOpen] = useState(false);
  const [isSharingReading, setIsSharingReading] = useState(false);
  // The link to the PDF alone, once this user has asked for it. Held only
  // while the menu is open, and never loaded on arrival: it is nobody's, and
  // showing it on the page would say something of theirs was out.
  const [paperLink, setPaperLink] = useState(null);
  // Off to begin with. Handing someone your annotations is a thing to
  // choose, not a thing to find out you have done.
  const [shareIncludesAnnotations, setShareIncludesAnnotations] = useState(false);
  // Set while the user is being asked what "stop sharing" should mean for
  // a link that carries their annotations.
  const [stoppingShare, setStoppingShare] = useState(false);
  const [readMenuOpen, setReadMenuOpen] = useState(false);
  const readControlRef = useRef(null);
  const shareControlRef = useRef(null);
  const readingUrlRef = useRef(null);
  const menuReadingUrlRef = useRef(null);

  // Shown once, the first time one of the user's own papers opens: each
  // part of it can be kept private or made public. Remembered as soon as it
  // appears, so leaving the page any way at all still counts as seen.
  const [learnVisibility, setLearnVisibility] = useState(false);
  const learnVisibilityRef = useRef(null);
  const ownPaperOpen = Boolean(currentUser && paper?.copy_uuid);
  useEffect(() => {
    if (!ownPaperOpen || isFeatureStateSet(VISIBILITY_TIP)) return;
    setFeatureState(VISIBILITY_TIP, true);
    setLearnVisibility(true);
  }, [ownPaperOpen]);
  useDismiss(learnVisibility, learnVisibilityRef, () => setLearnVisibility(false));

  useDismiss(readMenuOpen, readControlRef, () => setReadMenuOpen(false));

  useDismiss(shareOpen, shareControlRef, () => {
    setPaperLink(null);
    setShareOpen(false);
  });

  useEffect(() => {
    loadPaper();
  }, [paperSha256]);

  // Coming back from the viewer is a history step, so the browser restores
  // this page from its cache with whatever it showed when the user
  // left. Refetch when the page is shown again, unless a form is open and
  // would lose what is in it.
  useEffect(() => {
    const refresh = () => {
      if (editMode || editingSummary || editingThought) return;
      loadPaper();
    };
    const onShow = (e) => {
      if (e.persisted) refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('pageshow', onShow);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('pageshow', onShow);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [paperSha256, editMode, editingSummary, editingThought]);

  // Every load after the first follows a change made here, so whatever lists
  // this paper beside the page (Papol macOS's nook) is told to catch up.
  // A field this device may not write reaches the service and only comes back
  // on the next pull, which the save does not wait for. Such a save passes
  // what the service returned as an overlay, so the reload does not redraw
  // the value the user just replaced.
  const loadedOnce = useRef(false);
  const loadPaper = async (overlay = null) => {
    setError(null);
    try {
      const data = await getPaper(paperSha256);
      setPaper(overlay ? { ...data, ...overlay } : data);
      if (currentUser && data.copy_uuid) {
        listShelves().then(setShelves).catch((err) => setError(err.message));
      }
      if (loadedOnce.current) onChanged?.();
      loadedOnce.current = true;
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // The paper is its PDF, and the content hash is what names that PDF in
  // a viewer URL.
  const viewerHref = () => {
    if (!paper?.sha256) return null;
    return appPath(`/viewer/?pdf=${paper.sha256}`);
  };

  const startMetadataEdit = () => {
    setEditData({
      title: paper.title,
      authors: authorList(paper.authors).join(', '),
      journal: paper.journal || '',
      year: paper.year || '',
      doi: paper.doi || '',
    });
    setMetadataFound(null);
    setEditMode('metadata');
  };


  const handleEditChange = (e) => {
    const { name, value } = e.target;
    setEditData((prev) => ({ ...prev, [name]: value }));
  };

  // The ratings are patched into the replica and read back from it. is_author
  // is not a field this device may write, so its saved value returns only from
  // the service, and the reload would redraw the box the user just ticked.
  const handleInlineRating = async (key, value) => {
    setError(null);
    try {
      const saved = await updatePaper(paper.sha256, { [key]: value });
      loadPaper(key === 'is_author' ? { is_author: saved?.is_author ?? value } : null);
    } catch (err) {
      setError(err.message);
    }
  };

  // Each of thought, ratings, summary and tags is public or private on its
  // own; the chip beside its heading turns it the other way.
  const visibilityChip = (field) => (
    <VisibilityChip
      shown={paper[field]}
      onDisplay={paper.is_public}
      onToggle={() => handleInlineRating(field, !paper[field])}
    />
  );
  const tint = (field) => (paper[field] ? 'vis-public' : 'vis-private');

  const handleShelfChange = async (shelfUuid) => {
    setError(null);
    setToggleWarning(null);
    try {
      await updatePaper(paper.sha256, { shelf_uuid: shelfUuid });
      loadPaper();
    } catch (err) {
      setToggleWarning(err.message);
    }
  };

  const handleAddToNook = async () => {
    setError(null);
    setIsAddingToNook(true);
    try {
      const added = await addToNook(paper);
      setPaper(added);
      // Swap the address to the canonical form without pushing a history
      // entry — it is the same page, and Back should leave it, not repeat it.
      window.history.replaceState(
        window.history.state,
        '',
        appPath(`/paper/${paperName(added.sha256)}`),
      );
      // Reload rather than stop at the returned copy: a paper just taken into
      // the nook needs the user's shelves for its shelf menu.
      loadPaper();
    } catch (err) {
      setError(err?.message || String(err));
      if (err?.reportable !== false) {
        onReportableError?.(err, 'adding a paper to My Nook');
      }
    } finally {
      setIsAddingToNook(false);
    }
  };

  const copyLink = async (link, target) => {
    let copied = true;
    try {
      await copyText(link);
    } catch {
      copied = false;
    }
    setShareCopied({ target, status: copied ? 'copied' : 'failed' });
    window.setTimeout(() => setShareCopied({ target: null, status: 'idle' }), 1800);
  };

  // The paper's link is copied before it is shown, so its button has to
  // name what it will hand over rather than repeat a bare "Copy".
  const paperLinkLabel = () => (
    shareCopied.target === 'menu-reading' ? copyLabel('menu-reading') : 'Copy link'
  );

  const copyLabel = (target) => {
    if (shareCopied.target !== target) return 'Copy';
    return shareCopied.status === 'copied' ? 'Copied!' : 'Copy failed';
  };

  // A sharable hands this reading — this PDF, with this user's anchors, ink
  // and clips on it — to anyone holding the link. Nothing is copied: what a
  // visitor sees is what the user has now, until the link is taken back.
  const handleShareReading = async () => {
    setError(null);
    setIsSharingReading(true);
    try {
      const sharable = await createSharable(paper.sha256, {
        includeAnnotations: shareIncludesAnnotations,
      });
      const href = sharableHref(sharable.uuid);
      // A reading is this user's and stays on their page. The paper's
      // link is nobody's: it is copied and passed on, and the page says
      // nothing about it afterwards — there is nothing of theirs to say.
      if (shareIncludesAnnotations) {
        setPaper((current) => ({ ...current, sharable_uuid: sharable.uuid }));
      } else {
        setPaperLink(href);
      }
      copyLink(href, 'menu-reading');
    } catch (err) {
      setError(err?.message || String(err));
      if (err?.reportable !== false) {
        onReportableError?.(err, 'sharing a reading of a paper');
      }
    } finally {
      setIsSharingReading(false);
    }
  };

  // Taking a link back and taking your annotations out of it are different
  // things, and a link that carries annotations can do either. Asking is what
  // stops someone breaking a colleague's link when all they wanted was
  // their annotations back.
  const handleStopSharing = () => setStoppingShare(true);

  const revokeShare = async () => {
    setError(null);
    setStoppingShare(false);
    try {
      await revokeSharable(paper.sharable_uuid);
      setPaper((current) => ({ ...current, sharable_uuid: null }));
      setShareIncludesAnnotations(false);
    } catch (err) {
      setError(err?.message || String(err));
      if (err?.reportable !== false) {
        onReportableError?.(err, 'stopping the sharing of a reading');
      }
    }
  };

  const dropSharedAnnotations = async () => {
    setError(null);
    try {
      await leanSharable(paper.sharable_uuid);
      // The link lives on for whoever holds it, carrying the paper alone —
      // and stops being this user's, so it leaves their page with their
      // annotations.
      setPaper((current) => ({ ...current, sharable_uuid: null }));
      setStoppingShare(false);
    } catch (err) {
      setError(err?.message || String(err));
      if (err?.reportable !== false) {
        onReportableError?.(err, 'dropping annotations from a shared link');
      }
    }
  };

  const handleDelete = async () => {
    if (!(await confirmAction('Remove this paper from your nook? Your ratings and annotations will be deleted. This cannot be undone.', { confirmLabel: 'Remove', destructive: true }))) return;
    try {
      await deletePaper(paper.sha256);
    } catch (err) {
      setError(err.message);
      return;
    }
    // The page stays on the jacket: the paper is still a paper, only no
    // longer one of theirs, so it is read again and shown as any paper
    // outside their nook is, with the way to add it back. Only where it
    // cannot be read again (Papol macOS offline, with the copy gone from
    // this Mac) is there nothing left to show, and the jacket is left.
    setEditMode(null);
    try {
      setPaper(await getPaper(paperSha256));
      onChanged?.();
    } catch {
      onChanged?.();
      (onDeleted || onBack)?.();
    }
  };

  const handleMetadataSave = async () => {
    setError(null);
    try {
      const authorsList = editData.authors
        .split(',')
        .map((a) => a.trim())
        .filter((a) => a);

      await updatePaper(paper.sha256, {
        title: editData.title,
        authors: JSON.stringify(authorsList),
        journal: editData.journal || null,
        year: editData.year ? parseInt(editData.year) : null,
        doi: editData.doi || null,
      });

      setEditMode(null);
      window.location.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  // The reading is offered, never written in: the details are every
  // reader's, and a reading can be wrong (metadataReview.js).
  const offerMetadata = (candidates, note = null) => {
    const usable = candidates.filter((candidate) => candidate.fields);
    if (!usable.length) { setMetadataFound(null); return; }
    const changes = metadataChanges(editData, usable[0].fields);
    setMetadataFound({ candidates: usable, which: usable[0].key, chosen: new Set(changes.map((c) => c.field)), note });
  };

  const handleMetadataExtract = async () => {
    setError(null);
    setMetadataFound(null);
    setIsExtractingMetadata(true);
    setMetadataExtractStatus('Reading PDF…');
    let href = null;
    let titleBlock = null;
    try {
      // The title block is read here, off the PDF this jacket shows: the
      // Mac's own copy, else the file on the server.
      href = localPdf ? await nativeBlobUrl(paper.sha256, 'application/pdf').catch(() => null) : pdfHref(paper);
      const printed = href ? await readPrintedAt(href) : null;
      titleBlock = printed?.title_block ?? null;
      setMetadataExtractStatus(titleBlock ? 'Read the PDF. Checking scholarly registries…' : 'No title block found in the PDF. Checking scholarly registries…');
      const extracted = await reextractPaperMetadata(paper.sha256, printed);
      offerMetadata(metadataCandidates(extracted));
    } catch (err) {
      // The registries could not answer: what the PDF prints, if it was read.
      if (titleBlock) offerMetadata([{ key: 'found', label: null, fields: foundFields(titleBlock) }], `Scholarly registries could not be reached (${err.message}); this is what the PDF prints.`);
      else setError(err.message);
    } finally {
      if (localPdf && href) URL.revokeObjectURL(href);
      setIsExtractingMetadata(false);
    }
  };

  const foundCandidate = metadataFound?.candidates.find((candidate) => candidate.key === metadataFound.which);
  const foundChanges = foundCandidate ? metadataChanges(editData, foundCandidate.fields) : [];
  const chooseCandidate = (key) => {
    const candidate = metadataFound.candidates.find((c) => c.key === key);
    setMetadataFound({ ...metadataFound, which: key, chosen: new Set(metadataChanges(editData, candidate.fields).map((c) => c.field)) });
  };
  const toggleFound = (field) => {
    const chosen = new Set(metadataFound.chosen);
    if (chosen.has(field)) chosen.delete(field); else chosen.add(field);
    setMetadataFound({ ...metadataFound, chosen });
  };
  const useFound = () => {
    setEditData((current) => applyChanges(current, foundChanges, metadataFound.chosen));
    setMetadataFound(null);
  };

  const saveSummary = async () => {
    setError(null);
    try {
      await updatePaper(paper.sha256, { summary: summaryDraft.trim() || null });
      setEditingSummary(false);
      loadPaper();
    } catch (err) {
      setError(err.message);
    }
  };

  const saveThought = async () => {
    setError(null);
    try {
      const saved = await updatePaper(paper.sha256, { thought: thoughtDraft.trim() || null });
      setEditingThought(false);
      loadPaper({ thought: saved?.thought ?? null });
    } catch (err) {
      setError(err.message);
    }
  };

  if (isLoading) {
    return <div className="loading"><Working label="Loading paper…" /></div>;
  }

  if (error && !paper) {
    return (
      <div className="panel paper-jacket">
        <div className="error" role="alert">{error}</div>
        {!hideBack && <BackLink href={backHref} onBack={onBack}>{backLabel}</BackLink>}
      </div>
    );
  }

  if (!paper) {
    return <div>Paper not found</div>;
  }

  const authors = authorList(paper.authors);
  const hasEntry = currentUser != null && paper.copy_uuid != null;
  // The reader's own dig on the paper, which they write whether or not
  // they keep it.
  const yourDig = (
    <section className="paper-dig" id="your-dig" aria-labelledby="paper-dig-title">
      <h4 id="paper-dig-title">
        Your dig
        {/* A dig goes where its paper goes: on a public shelf, or on
            no shelf of mine at all, my friends can read it and post
            in it, and nobody else. A paper I took out of my nook is
            withdrawn, and my dig on it with it. */}
        {(paper.digs_shown ?? paper.is_public)
          ? <span className="badge visibility-badge friends" title={hasEntry
            ? 'Your friends can read this dig and post in it while the paper is on a public shelf. Nobody else can.'
            : 'Your friends can read this dig and post in it. Nobody else can. To keep it to yourself, add the paper to your nook and move it to a private shelf.'}>friends</span>
          : <span className="badge visibility-badge private" title={hasEntry
            ? 'On a private shelf, a dig is yours alone.'
            : 'You took this paper out of your nook, so your dig on it is yours alone. Add it back on a public shelf for your friends to read it.'}>private</span>}
      </h4>
      <TalkCard
        key={paper.sha256} inline single conversation tucked dig="mine" projectUuid={null}
        subject={`paper:${paper.sha256}`} label={paper.title} currentUser={currentUser}
      />
    </section>
  );
  // A link hands over a PDF, so there has to be one to hand over: a paper
  // with no readable file has nothing for the viewer to open.
  const canShareThisPdf = hasEntry && Boolean(paper.file_path);
  const assignedTagUuids = new Set(paper.tags.map((tag) => tag.uuid));
  const tagQuery = tagDraft.trim().toLowerCase();
  const tagSuggestions = availableTags.filter(
    (tag) => !assignedTagUuids.has(tag.uuid) && (!tagQuery || tag.name.toLowerCase().includes(tagQuery))
  );
  const tagExists = availableTags.some((tag) => tag.name.toLowerCase() === tagQuery);
  const attachTag = async (tag) => {
    await updatePaper(paper.sha256, {
      tag_uuids: [...assignedTagUuids, tag.uuid],
    });
    setTagDraft('');
    setTagMenuOpen(false);
    setAvailableTags((current) => current.some((item) => item.uuid === tag.uuid) ? current : [...current, tag]);
    loadPaper();
  };
  const openViewer = () => {
    const href = viewerHref();
    if (!href) return;
    if (onRead) onRead(href);
    else window.location.assign(href);
  };
  // Papol macOS keeps the user's PDF in its local store. Save that copy,
  // which needs no network and exists before the paper syncs, and read it
  // only when asked, since a PDF can be large.
  const localPdf = nativeDataActive() && hasEntry && Boolean(paper.sha256);
  const saveLocalPdf = async () => {
    try {
      const href = await nativeBlobUrl(paper.sha256, 'application/pdf');
      const link = document.createElement('a');
      link.href = href;
      link.download = pdfFileName(paper);
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
    } catch (err) {
      const message = err?.message || String(err);
      if (/blob is not available offline|pdf is not available in the local replica/i.test(message)) {
        setError('This PDF has not finished downloading to this Mac. Connect to the internet and choose Sync, then try again.');
      } else {
        setError(`PDF download failed: ${message}`);
        onReportableError?.(err, 'downloading a PDF from My Nook');
      }
    }
  };

  // What is the member's own about the paper: its shelf, its removal, and
  // whether they wrote it.
  const shelfControls = hasEntry && (
    <div className="detail-toggle">
      <span className="hint-anchor paper-shelf-picker">
        <label htmlFor="paper-shelf">Shelf:</label>
        <select id="paper-shelf" value={paper.shelf_uuid || ''} onChange={(e) => handleShelfChange(shelves.find((shelf) => String(shelf.uuid) === e.target.value)?.uuid)}>
          {shelves.map((shelf) => (
            <option key={shelf.uuid} value={shelf.uuid}>{shelf.name} · {shelf.is_public ? 'Public' : 'Private'}</option>
          ))}
        </select>
        {toggleWarning && (
          <HintPop
            text={toggleWarning}
            onClose={() => setToggleWarning(null)}
          />
        )}
      </span>
      <PinButton sha256={paper.sha256} pinned={Boolean(paper.pinned)} className="icon-button jacket-pin" size={19} onChanged={() => loadPaper()} />
      <button
        className="icon-button danger-icon"
        onClick={handleDelete}
        title="Remove this paper from my nook — my ratings and annotations go with it"
        aria-label="Remove from my nook"
      >
        <svg
          width="19"
          height="19"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2.6 4h10.8" />
          <path d="M6.2 4V2.7h3.6V4" />
          <path d="M4.1 4l.5 9.1a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9L11.9 4" />
          <path d="M6.7 6.6v5.2M9.3 6.6v5.2" />
        </svg>
      </button>
    </div>
  );
  const authorCheck = hasEntry && (
    <label
      className="checkbox-row inline"
      title="Marks your chip on this paper as an author"
    >
      <input
        type="checkbox"
        checked={paper.is_author === true}
        onChange={(e) =>
          handleInlineRating('is_author', e.target.checked)
        }
      />
      <span>I am an author</span>
    </label>
  );

  return (
    <div className="paper-jacket">
      {/* Editing the details takes over the page, and its Cancel is the
          way out: a Back beside it would leave with the edit half made. */}
      {!hideBack && editMode !== 'metadata' && (
        <BackLink className="back-button" href={backHref} onBack={onBack}>&larr; {backLabel}</BackLink>
      )}

      {error && <div className="error" role="alert">{error}</div>}

      <div className="panel">
      {editMode === 'metadata' ? (
        <div className="paper-form">
          <div className="warning">
            These paper details are shared. Changes you make here update them
            for every user.
          </div>

          {/* The panel of what was found takes the button's place until
              the user has answered it. */}
          {!metadataFound && (
            <div className="form-actions metadata-extract-action">
              <button
                type="button"
                onClick={handleMetadataExtract}
                disabled={isExtractingMetadata}
              >
                {isExtractingMetadata ? 'Extracting…' : 'Extract metadata from PDF'}
              </button>
              {isExtractingMetadata && <Working label={metadataExtractStatus} />}
            </div>
          )}

          {metadataFound && (
            <div className="metadata-found" role="region" aria-label="Details found in the PDF">
              {metadataFound.note && <p className="metadata-found-note">{metadataFound.note}</p>}
              {metadataFound.candidates.length > 1 && (
                <div className="metadata-found-sources" role="radiogroup" aria-label="Which details">
                  {metadataFound.candidates.map((candidate) => (
                    <label key={candidate.key} className="checkbox-row inline">
                      <input type="radio" name="metadata-found-source" checked={metadataFound.which === candidate.key} onChange={() => chooseCandidate(candidate.key)} />
                      <span>{candidate.label}</span>
                    </label>
                  ))}
                </div>
              )}
              {foundChanges.length ? (
                <>
                  <p className="metadata-found-heading">Found for this PDF. Tick the details to use:</p>
                  <ul className="metadata-found-list">
                    {foundChanges.map((change) => (
                      <li key={change.field}>
                        <label className="checkbox-row">
                          <input type="checkbox" checked={metadataFound.chosen.has(change.field)} onChange={() => toggleFound(change.field)} />
                          <span className="metadata-found-field">{change.label}</span>
                          <span className="metadata-found-change">
                            {change.from ? <del>{change.from}</del> : <span className="metadata-found-empty">empty</span>}
                            <span aria-hidden="true"> → </span>
                            <ins>{change.to}</ins>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <div className="form-actions">
                    <button type="button" className="primary" onClick={useFound} disabled={!metadataFound.chosen.size}>Use selected</button>
                    <button type="button" onClick={() => setMetadataFound(null)}>Keep current details</button>
                  </div>
                </>
              ) : (
                <div className="metadata-found-same">
                  <span>The details found match what is here.</span>
                  <button type="button" onClick={() => setMetadataFound(null)}>OK</button>
                </div>
              )}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="paper-metadata-title">Title</label>
            <input
              id="paper-metadata-title"
              type="text"
              name="title"
              value={editData.title}
              onChange={handleEditChange}
            />
          </div>

          <div className="form-group">
            <label htmlFor="paper-metadata-authors">Authors (comma-separated)</label>
            <input
              id="paper-metadata-authors"
              type="text"
              name="authors"
              value={editData.authors}
              onChange={handleEditChange}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="paper-metadata-journal">Journal</label>
              <input
                id="paper-metadata-journal"
                type="text"
                name="journal"
                value={editData.journal}
                onChange={handleEditChange}
              />
            </div>

            <div className="form-group">
              <label htmlFor="paper-metadata-year">Year</label>
              <input
                id="paper-metadata-year"
                type="number"
                name="year"
                value={editData.year}
                onChange={handleEditChange}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="paper-metadata-doi">DOI</label>
            <input
              id="paper-metadata-doi"
              type="text"
              name="doi"
              value={editData.doi}
              onChange={handleEditChange}
            />
          </div>

          {hasEntry && (
            <div className="form-group">
              <div className="form-label">PDF</div>
              <div className="pdf-row">
                <a
                  className="button"
                  href={pdfHref(paper)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => {
                    if (!localPdf) return;
                    event.preventDefault();
                    openViewer();
                  }}
                >
                  View PDF
                </a>
              </div>
            </div>
          )}

          <div className="form-actions">
            <button onClick={() => setEditMode(null)}>
              Cancel
            </button>
            <button className="primary" onClick={handleMetadataSave}>
              Save Metadata
            </button>
          </div>
        </div>
      ) : (
        <div className="paper-info">
          {inBar ? (
            <>
              {/* On the bar, what the paper is; in the jacket, what is the
                  member's own about it. */}
              <InWay>
                <div className="paper-way-head">
                  <h2><PaperTitle title={paper.title} /></h2>
                  <div className="paper-way-facts">
                    {authors.length > 0 && <p className="authors">{authors.join(', ')}</p>}
                    {(paper.journal || paper.year) && (
                      <p className="metadata">
                        {paper.journal && <span className="journal">{paper.journal}</span>}
                        {paper.year && <span className="year">{paper.year}</span>}
                      </p>
                    )}
                  </div>
                </div>
              </InWay>
              {hasEntry && <div className="paper-own-row">{authorCheck}{shelfControls}</div>}
              {paper.doi && (
                <div className="metadata">
                  <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noopener noreferrer" className="doi">
                    {paper.doi}
                  </a>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="detail-title-row">
                <h2><PaperTitle title={paper.title} /></h2>
                {shelfControls}
              </div>
              {authors.length > 0 && (
                <div className="detail-authors-row">
                  <p className="authors">{authors.join(', ')}</p>
                  {/* Sits level with the names it refers to, however many lines
                      they run to — as the display controls do with the title. */}
                  {authorCheck}
                </div>
              )}
              <div className="metadata">
                {paper.journal && <span className="journal">{paper.journal}</span>}
                {paper.year && <span className="year">{paper.year}</span>}
                {paper.doi && (
                  <a
                    href={`https://doi.org/${paper.doi}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="doi"
                  >
                    {paper.doi}
                  </a>
                )}
              </div>
            </>
          )}

          <div className="paper-actions">
            {/* Reading does not wait for the paper to be taken: the viewer
                opens one that is not yet theirs all the same, to read and
                to dig, with the nook on offer in its bar (on the Mac, as a
                lean link). Until it is theirs, adding it is the step that
                carries the weight. */}
            {currentUser && viewerHref() && (
              <a
                className={hasEntry ? 'button primary' : 'button'}
                href={viewerHref()}
                data-document
                onClick={(event) => {
                  if (!onRead || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                  event.preventDefault();
                  openViewer();
                }}
              >
                Read
              </a>
            )}
            {!currentUser && (
              <div className="share-control" ref={readControlRef}>
                <button
                  type="button"
                  className="primary"
                  aria-expanded={readMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => setReadMenuOpen((open) => !open)}
                >
                  Read <span aria-hidden="true">▾</span>
                </button>
                {readMenuOpen && (
                  <div className="share-menu read-menu" role="menu">
                    <a
                      role="menuitem"
                      href={pdfHref(paper)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <strong>Read PDF directly</strong>
                      <span>Open the original PDF in your browser.</span>
                    </a>
                    <a
                      role="menuitem"
                      href={appPath(`/signin?next=${encodeURIComponent(`/paper/${paperName(paper.sha256)}`)}`)}
                      title="Sign in to use the built-in viewer"
                    >
                      <strong>Use built-in viewer</strong>
                      <span>Sign in required — continue to sign in.</span>
                    </a>
                  </div>
                )}
              </div>
            )}
            {/* Leaves with a copy of the PDF, saved under the paper's title
                (Papol macOS puts it in Downloads). A copy hosted elsewhere
                cannot be named from here, so it opens in a new tab instead
                of taking the user away from Papol. */}
            {paper.file_path && (
              <a
                className="button"
                href={pdfHref(paper)}
                download={pdfFileName(paper)}
                onClick={(event) => {
                  if (!localPdf) return;
                  event.preventDefault();
                  saveLocalPdf();
                }}
                {...(pdfHref(paper).startsWith('http')
                  ? { target: '_blank', rel: 'noopener noreferrer' }
                  : {})}
              >
                Download
              </a>
            )}
            {hasEntry && (
              <button onClick={startMetadataEdit}>Edit</button>
            )}
            {currentUser && !hasEntry && (
              /* The actual next step, so it carries the weight. */
              <button className="primary" onClick={handleAddToNook} disabled={isAddingToNook}>
                {isAddingToNook ? 'Adding to nook…' : 'Add to my nook'}
              </button>
            )}
            {currentUser && canShareThisPdf && (
              <div className="share-control" ref={shareControlRef}>
                <button
                  type="button"
                  aria-expanded={shareOpen}
                  aria-haspopup="menu"
                  onClick={() => {
                    setPaperLink(null);
                    setShareOpen((open) => !open);
                  }}
                >
                  Share <span aria-hidden="true">▾</span>
                </button>
                {shareOpen && (
                  <div className="share-menu share-links-menu" role="menu">
                    {/* What sharing a paper means here: the PDF itself,
                        opened in Papol's viewer by whoever is given the
                        link. One link, whether or not the user's annotations
                        travel on it. */}
                    <div className="share-menu-section">
                      <span className="share-menu-heading">This PDF</span>
                      {paper.sharable_uuid ? (
                        <>
                          <p className="share-note">
                            Opens in Papol’s viewer, with your anchors, paint and
                            clips on it.
                          </p>
                          <div className="share-link-row">
                            <input
                              id="menu-share-url"
                              aria-label="Link to this PDF"
                              ref={menuReadingUrlRef}
                              value={sharableHref(paper.sharable_uuid)}
                              readOnly
                              onFocus={(event) => event.target.select()}
                            />
                            <button
                              type="button"
                              onClick={() => copyLink(sharableHref(paper.sharable_uuid), 'menu-reading')}
                            >
                              {copyLabel('menu-reading')}
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="share-note">
                            A read-only link that opens this PDF in Papol’s viewer.
                          </p>
                          {/* The one decision worth making here, named by what
                              it gives away rather than by what we call it. */}
                          <label className="share-annotations-choice">
                            <input
                              type="checkbox"
                              checked={shareIncludesAnnotations}
                              onChange={(event) => {
                                setPaperLink(null);
                                setShareIncludesAnnotations(event.target.checked);
                              }}
                            />
                            Include my anchors, paint and clips
                          </label>
                          {/* Without the annotations there is nothing of theirs to
                              create: the PDF has a link, and this is the
                              user taking hold of it to pass on. With them,
                              a reading of their own is made. */}
                          <button
                            type="button"
                            onClick={handleShareReading}
                            disabled={isSharingReading}
                          >
                            {isSharingReading
                              ? (shareIncludesAnnotations ? 'Making a link…' : 'Copying…')
                              : (shareIncludesAnnotations ? 'Create a link' : paperLinkLabel())}
                          </button>
                          {paperLink && (
                            <div className="share-link-row">
                              <input
                                id="menu-share-url"
                                aria-label="Link to this PDF"
                                ref={menuReadingUrlRef}
                                value={paperLink}
                                readOnly
                                onFocus={(event) => event.target.select()}
                              />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            {hasEntry && (
              <ProjectPicker paper={paper} onThought={(thought) => loadPaper({ thought })} />
            )}
          </div>

          {/* A link out is a state of this paper, not an item in a menu.
              It stays on the page so that nothing the user does to the
              paper — moving it to a private shelf, above all — can quietly
              leave a link serving that they have forgotten about. */}
          {hasEntry && paper.sharable_uuid && (
            <div className="shared-reading-bar">
              <div className="shared-reading-head">
                <span className="badge visibility-badge shared">reading shared</span>
                <p>
                  Anyone with this link can read this PDF with your anchors, paint
                  and clips on it. They cannot change anything, and what they see
                  keeps up with what you write.
                </p>
              </div>
              <div className="share-link-row">
                <input
                  id="reading-share-url"
                  aria-label="Link to your reading"
                  ref={readingUrlRef}
                  value={sharableHref(paper.sharable_uuid)}
                  readOnly
                  onFocus={(event) => event.target.select()}
                />
                <button
                  type="button"
                  onClick={() => copyLink(sharableHref(paper.sharable_uuid), 'reading')}
                >
                  {copyLabel('reading')}
                </button>
                <button
                  type="button"
                  className="share-revoke"
                  onClick={handleStopSharing}
                >
                  Stop sharing
                </button>
              </div>
              {/* Asked rather than assumed: dropping the annotations keeps the
                  link alive for whoever was given it, and revoking the link
                  does not. Only a link carrying annotations has both to offer. */}
              {stoppingShare && (
                <div className="shared-reading-ask" role="group" aria-label="Stop sharing">
                  <p>
                    Keep the link and take your anchors, paint and clips out of it,
                    or revoke the link altogether?
                  </p>
                  <div className="shared-reading-ask-actions">
                    <button type="button" className="primary" onClick={dropSharedAnnotations}>
                      Share the paper only
                    </button>
                    <button type="button" onClick={revokeShare}>
                      Revoke the link
                    </button>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setStoppingShare(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!currentUser && paper.also_read_by.length > 0 && (
            <p className="signed-out-reviews">
              <a href={appPath('/signin')}>Sign in</a> to see others’ reviews of the paper.
            </p>
          )}

          {currentUser && paper.also_read_by.length > 0 && (
            <div className="nooks-row">
              <span className="nooks-label">
                In {paper.also_read_by.length}{' '}
                {paper.also_read_by.length === 1 ? 'nook' : 'nooks'}:
              </span>
              <div className="title-chips">
                {[...paper.also_read_by].sort((a, b) => Number(isFriend(b.user.uuid)) - Number(isFriend(a.user.uuid))).map((entry) => (
                  <a
                    key={entry.user.uuid}
                    className={
                      entry.is_author
                        ? 'avatar-chip has-pop mini author'
                        : 'avatar-chip has-pop mini'
                    }
                    href={appPath(`/u/${entry.user.uuid}`)}
                  >
                    <Avatar user={entry.user} className="mini-avatar" />
                    <ReaderPop entry={entry} isYou={Boolean(currentUser) && entry.user.uuid === currentUser.uuid} isFriend={isFriend(entry.user.uuid)} />
                  </a>
                ))}
              </div>
            </div>
          )}


          {hasEntry && (
            <div className={`inline-ratings ${tint('ratings_public')}`}>
              <h4 className="kicker">
                My ratings
                <span className="visibility-lesson-anchor">
                  {visibilityChip('ratings_public')}
                  {learnVisibility && (
                    <span ref={learnVisibilityRef} className="learn-papol" role="dialog" aria-labelledby="learn-visibility-title">
                      <span className="learn-papol-kicker">Learn Papol</span>
                      <strong id="learn-visibility-title">Private or public</strong>
                      <span>Each part of this paper can be kept to yourself or shown to others. Press its badge to switch.</span>
                      <button type="button" className="learn-papol-close" onClick={() => setLearnVisibility(false)}>
                        Got it
                      </button>
                    </span>
                  )}
                </span>
              </h4>
              <RatingInput values={paper} onChange={handleInlineRating} />
            </div>
          )}

          {hasEntry && (
            <div className={`inline-thought ${tint('thought_public')}`}>
              <h4 className="kicker">
                My thought
                {visibilityChip('thought_public')}
                {!editingThought && paper.thought && (
                  <button
                    className="link-button summary-edit"
                    onClick={() => {
                      setThoughtDraft(paper.thought || '');
                      setEditingThought(true);
                    }}
                  >
                    edit
                  </button>
                )}
              </h4>
              {editingThought ? (
                <div className="inline-edit">
                  <AutoTextarea
                    className="inline-edit-box"
                    value={thoughtDraft}
                    maxLength={appLimits.text.paper_thought}
                    rows={2}
                    autoFocus
                    placeholder="Your one-line take on this paper"
                    onChange={(e) => setThoughtDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setEditingThought(false);
                    }}
                  />
                  <div className="inline-edit-actions">
                    <button className="primary" onClick={saveThought}>
                      Save
                    </button>
                    <button onClick={() => setEditingThought(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : paper.thought ? (
                <p className="inline-thought-text">{paper.thought}</p>
              ) : (
                <button
                  className="link-button"
                  onClick={() => {
                    setThoughtDraft('');
                    setEditingThought(true);
                  }}
                >
                  Add a one-sentence thought
                </button>
              )}
            </div>
          )}

        </div>
      )}

      {/* Below the separator, what the user keeps of the paper: summary,
          tags and their dig. The dig is theirs alone; summary and tags, like
          the thought and ratings above, are whichever their chip says. */}
      {hasEntry && editMode !== 'metadata' && (
        <div className="paper-notes">
          <div className={`summary-block ${tint('summary_public')}`}>
            <h4>
              Summary
              {visibilityChip('summary_public')}
              {!editingSummary && paper.summary && (
                <button
                  className="link-button summary-edit"
                  onClick={() => {
                    setSummaryDraft(paper.summary || '');
                    setEditingSummary(true);
                  }}
                >
                  edit
                </button>
              )}
            </h4>
            {editingSummary ? (
              <div className="inline-edit">
                <MarkdownField
                  className="inline-edit-box auto-grow"
                  value={summaryDraft}
                  rows={4}
                  autoFocus
                  placeholder="A summary of the paper"
                  onChange={(e) => setSummaryDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditingSummary(false);
                  }}
                />
                <MarkdownHint />
                <div className="inline-edit-actions">
                  <button className="primary" onClick={saveSummary}>
                    Save
                  </button>
                  <button onClick={() => setEditingSummary(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : paper.summary ? (
              <div className="summary-text">
                <Markdown text={paper.summary} />
              </div>
            ) : (
              <button
                className="link-button"
                onClick={() => {
                  setSummaryDraft('');
                  setEditingSummary(true);
                }}
              >
                Add a summary
              </button>
            )}
          </div>

          <section className={`paper-tags ${tint('tags_public')}`} aria-labelledby="paper-tags-title">
            <h4 id="paper-tags-title">
              Tags
              {visibilityChip('tags_public')}
            </h4>
            <div className="tag-editor-card">
              <div className="tag-picker">
                <div className="tag-editor">
                  {paper.tags.map((tag) => (
                    <button
                      type="button"
                      className="tag-chip selected"
                      key={tag.uuid}
                      onClick={async () => {
                        await updatePaper(paper.sha256, { tag_uuids: paper.tags.filter((t) => t.uuid !== tag.uuid).map((t) => t.uuid) });
                        loadPaper();
                      }}
                      title="Remove tag from this paper"
                    >{tag.name} ×</button>
                  ))}
                  <input
                    className="tag-input"
                    value={tagDraft}
                    placeholder="Add a tag…"
                    aria-label="Add a tag"
                    onFocus={() => { setTagMenuOpen(true); listTags().then(setAvailableTags).catch((err) => setError(err.message)); }}
                    onBlur={() => setTagMenuOpen(false)}
                    onChange={(e) => { setTagDraft(e.target.value); setTagMenuOpen(true); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setTagMenuOpen(false);
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      if (tagSuggestions.length === 1) {
                        attachTag(tagSuggestions[0]).catch((err) => setError(err.message));
                      } else if (tagQuery && !tagExists) {
                        createTag(tagDraft.trim())
                          .then(attachTag)
                          .catch((err) => setError(err.message));
                      }
                    }}
                  />
                </div>
                {tagMenuOpen && (
                  <div className="tag-dropdown">
                    {tagSuggestions.length > 0 && <div className="tag-dropdown-label">Your tags</div>}
                    {tagSuggestions.map((tag) => (
                      <button type="button" key={tag.uuid} onMouseDown={(e) => e.preventDefault()} onClick={() => attachTag(tag).catch((err) => setError(err.message))}>
                        <span className="tag-option-mark">#</span>
                        <span>{tag.name}</span>
                        <span className="tag-option-hint">Add</span>
                      </button>
                    ))}
                    {tagQuery && !tagExists && (
                      <button type="button" className="tag-create-option" onMouseDown={(e) => e.preventDefault()} onClick={async () => {
                        try { await attachTag(await createTag(tagDraft.trim())); } catch (err) { setError(err.message); }
                      }}>
                        <span className="tag-create-mark">+</span>
                        <span>Create <strong>{tagDraft.trim()}</strong></span>
                      </button>
                    )}
                    {!tagQuery && tagSuggestions.length === 0 && <span className="tag-empty">All of your tags are already on this paper.</span>}
                  </div>
                )}
              </div>
            </div>
          </section>

          {yourDig}

        </div>
      )}
      {/* Nobody needs a paper in their nook to dig it: a friend's paper,
          or one opened from the Lounge, takes a dig as it stands. */}
      {currentUser && !hasEntry && editMode !== 'metadata' && (
        <div className="paper-notes paper-notes-unkept">
          {yourDig}
        </div>
      )}
      {friendDigs.length > 0 && (
        <section className="paper-dig paper-friend-digs" aria-labelledby="paper-friend-digs-title">
          <h4 id="paper-friend-digs-title">Friends’ digs</h4>
          <ul className="friend-digs">
            {friendDigs.map((dig) => (
              <li key={dig.uuid} id={`dig-${dig.uuid}`} className="friend-dig">
                {/* The dig's own first line already says whose it is and when,
                    so what stands over it is what it is about: the whole
                    paper, or a place in it, which opens the paper there. */}
                <FriendDigFocus dig={dig} paper={paper} />
                <TalkCard
                  inline single conversation tucked only projectUuid={null} dig={dig.uuid}
                  subject={`dig:${dig.uuid}`} label={paper.title} currentUser={currentUser}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      </div>
    </div>
  );
}
