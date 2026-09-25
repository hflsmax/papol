import React, { useEffect, useState, useRef } from 'react';
import { syncFailureText } from '../../../shared/syncFailure.js';
import { Progress, Working } from '../../../shared/ui/Waiting.js';
import { formatBytes, formatProgressDetail, formatRate, progressFraction } from '../../../shared/waiting.js';
import {
  updateProfile,
  changePassword,
  uploadAvatar,
  deleteAccount,
} from '../../../shared/api/account.js';
import { downloadMyData } from '../myData.js';
import Avatar from './Avatar';
import { confirmAction } from '../../../shared/confirmAction';
import { DESKTOP, MAC } from '../../../shared/desktopShell';
import MacHandoffSettings from './MacHandoffSettings.jsx';
import ActivityPanel from './ActivityPanel.jsx';
import {
  getLocalSyncPreference,
  setLocalSyncPreference,
} from '../../../shared/connectivity.js';
import {
  clearNativeData, hydrateNativeSyncPreference, makePdfViewerDefault,
  nativeRepository, nativeSyncInProgress, openDiagnosticLogsInFinder, openNativeStorageInFinder, pdfViewerStatus,
  persistNativeSyncPreference, subscribeNativeData, subscribeNativeSyncProgress, syncAllNow,
} from '../../../shared/nativeData.js';

const SYNC_PHASES = {
  uploading: 'Sending changes',
  snapshot: 'Checking library',
  pulling: 'Receiving changes',
  downloading: 'Downloading files',
};

// The sync's wait: a bar through the phase's items once the native side has
// counted them, the spinner before it has. The rate rides along in the
// detail when there is one.
function SyncWait({ progress }) {
  if (!progress) return <Working label="Starting…" />;
  const label = SYNC_PHASES[progress.phase] || 'Syncing';
  const fraction = progress.total
    ? (Number.isFinite(progress.fraction) ? progress.fraction : progressFraction(progress.completed, progress.total))
    : null;
  if (fraction == null) return <Working label={`${label}…`} />;
  const counted = `${Math.min(progress.completed + 1, progress.total)} of ${progress.total}`;
  const detail = progress.bytes_per_second > 0 ? `${counted} · ${formatRate(progress.bytes_per_second)}` : counted;
  return <Progress fraction={fraction} label={label} detail={detail} />;
}

// Which app a PDF opens in is the system's to say; this row reads it again
// whenever the window comes back, in case it was changed elsewhere.
function PdfViewerSetting() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const refresh = () => pdfViewerStatus().then(setStatus).catch(() => {});
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  if (!status?.supported) return null;

  const makeDefault = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await makePdfViewerDefault());
    } catch (failure) {
      setError(String(failure?.message ?? failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="local-setting-row local-storage-row">
      <div>
        <strong>Default PDF viewer</strong>
        <div className={`local-storage-totals${error ? ' error' : ''}`}>
          {error || (status.is_default
            ? 'Papol is your default PDF viewer.'
            : 'Another app is your default PDF viewer.')}
        </div>
      </div>
      {!status.is_default && (
        <button type="button" disabled={busy} onClick={makeDefault}>
          {busy ? 'Setting…' : 'Make Papol the default'}
        </button>
      )}
    </div>
  );
}

// Unlike the account fields below, these settings belong to this installation
// only. Keeping the component and storage API explicitly local prevents a new
// device preference from accidentally becoming part of updateProfile().
function LocalDeviceSettings({ onSynced }) {
  const [syncPreference, setSyncPreferenceState] = useState(getLocalSyncPreference);
  const [storage, setStorage] = useState(null);
  const [storageError, setStorageError] = useState(null);
  const [clearingData, setClearingData] = useState(false);
  // Progress arrives for every native sync, whether started here, from the
  // sidebar, or automatically, so the bar reflects whatever is running.
  const [sync, setSync] = useState({
    running: nativeSyncInProgress(), progress: null, error: null, lastBytes: null,
  });
  const processSyncing = useRef(false);

  useEffect(() => {
    hydrateNativeSyncPreference().then(setSyncPreferenceState).catch(() => {});
    nativeRepository.storageStatus().then(setStorage).catch(() => {});
    const stopProgress = subscribeNativeSyncProgress((progress) => {
      setSync((current) => ({ ...current, running: true, error: null, progress }));
    });
    const stopStatus = subscribeNativeData((payload) => {
      if (typeof payload?.syncing === 'boolean') processSyncing.current = payload.syncing;
      if (payload?.syncing === true) {
        setSync((current) => ({ ...current, running: true, error: null, progress: null }));
      } else if (payload?.syncing === false) {
        setSync((current) => ({
          ...current,
          running: false,
          progress: null,
          lastBytes: current.progress?.bytes ?? current.lastBytes,
        }));
        nativeRepository.storageStatus().then(setStorage).catch(() => {});
      } else if (typeof payload?.error === 'string') {
        setSync((current) => ({ ...current, error: payload.error }));
      }
    });
    // The start event may have fired before Settings mounted. Read the
    // coordinator's process-wide latch after subscribing so a sync started
    // by another surface is still visible here.
    nativeRepository.syncStatus().then((status) => {
      if (typeof status?.syncing === 'boolean') {
        processSyncing.current = status.syncing;
        setSync((current) => ({ ...current, running: status.syncing || nativeSyncInProgress() }));
      }
    }).catch(() => {});
    // A scheduled sync can end without reaching the native coordinator (offline
    // or signed out), so no {syncing:false} follows; recompute both ways.
    const refreshWindowSync = () => {
      const running = processSyncing.current || nativeSyncInProgress();
      setSync((current) => (current.running === running
        ? current
        : { ...current, running, ...(running ? { error: null } : {}) }));
    };
    window.addEventListener('papol-offline-status', refreshWindowSync);
    return () => {
      stopProgress();
      stopStatus();
      window.removeEventListener('papol-offline-status', refreshWindowSync);
    };
  }, []);

  const syncNow = async () => {
    setSync((current) => ({ ...current, running: true, error: null, progress: null }));
    const failure = await syncAllNow();
    const status = await nativeRepository.syncStatus().catch(() => null);
    if (typeof status?.syncing === 'boolean') processSyncing.current = status.syncing;
    setSync((current) => ({
      ...current,
      running: Boolean(status?.syncing || nativeSyncInProgress()),
      progress: null,
      error: failure,
    }));
    if (!failure) onSynced?.();
  };

  const chooseSyncPreference = (preference) => {
    setLocalSyncPreference(preference);
    persistNativeSyncPreference(preference).catch(() => {});
    setSyncPreferenceState(preference);
  };

  const clearData = async () => {
    const confirmed = await confirmAction(
      'Clear all data stored on this device? Unsynced data will be lost. This cannot be undone.',
      { confirmLabel: 'Clear data', destructive: true },
    );
    if (!confirmed) return;
    setClearingData(true);
    try {
      await clearNativeData();
      setStorage(await nativeRepository.storageStatus());
    } finally {
      setClearingData(false);
    }
  };

  const openStorage = async () => {
    setStorageError(null);
    try {
      await openNativeStorageInFinder();
    } catch (failure) {
      setStorageError(String(failure?.message ?? failure));
    }
  };

  const openLogs = async () => {
    setStorageError(null);
    try {
      await openDiagnosticLogsInFinder();
    } catch (failure) {
      setStorageError(String(failure?.message ?? failure));
    }
  };

  return (
    <div className="panel local-settings-panel">
      <h2 className="panel-title">On this Mac</h2>
      <p className="panel-note">
        Sync, storage, and file-opening preferences apply only to this Mac.
      </p>
      <div className="local-setting-row">
        <label htmlFor="local-sync-preference"><strong>Uploading</strong></label>
        <div className="local-sync-actions">
          <select
            id="local-sync-preference"
            value={syncPreference}
            onChange={(event) => chooseSyncPreference(event.target.value)}
          >
            <option value="automatic">Upload automatically</option>
            <option value="manual">Upload when I click Sync</option>
          </select>
          <button type="button" disabled={sync.running} onClick={syncNow}>
            {sync.running ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </div>
      {sync.running && (
        <div className="local-sync-progress">
          <SyncWait progress={sync.progress} />
        </div>
      )}
      {!sync.running && (sync.error || sync.lastBytes != null) && (
        <div className={`local-sync-detail${sync.error ? ' error' : ''}`} role="status">
          {syncFailureText(sync.error) || `Sync finished · ${formatBytes(sync.lastBytes)} transferred`}
        </div>
      )}
      <PdfViewerSetting />
      {storage && (
        <div className="local-setting-row local-storage-row">
          <div>
            <strong>Storage</strong>
            <div className="local-storage-totals">
              {formatBytes(storage.classes.unsynced.bytes)} unsynced ·{' '}
              {formatBytes(storage.classes.cache.bytes)} cache
            </div>
            {storageError && <div className="local-storage-totals error">{storageError}</div>}
          </div>
          <div className="local-storage-actions">
            {MAC && <button type="button" onClick={openLogs}>Open logs</button>}
            {MAC && <button type="button" onClick={openStorage}>Open in Finder</button>}
            <button
              type="button"
              className="danger"
              disabled={clearingData}
              onClick={clearData}
            >
              {clearingData ? 'Clearing…' : 'Clear data'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProfilePage({ user, onUserUpdated, onLogout, onSync }) {
  // Account settings in this component are global: their handlers call the
  // backend and the resulting values follow the user to every device.
  const [displayName, setDisplayName] = useState(user.display_name);
  const [affiliation, setAffiliation] = useState(user.affiliation || '');
  const [emailPublic, setEmailPublic] = useState(user.email_public);
  const [profileError, setProfileError] = useState(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState(null);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  // Changing a password is a thing you come to the page to do, not a
  // standing part of the page. It waits behind a button in the profile
  // block until it is asked for.
  const [changingPassword, setChangingPassword] = useState(false);

  const [isAvatarBusy, setIsAvatarBusy] = useState(false);
  const avatarFileRef = useRef(null);

  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [exported, setExported] = useState(null);
  const [exportStep, setExportStep] = useState(null);

  const [closeEmail, setCloseEmail] = useState('');
  const [closeError, setCloseError] = useState(null);
  const [isClosing, setIsClosing] = useState(false);
  const closeEmailMatches = closeEmail.trim().toLowerCase() === user.email.toLowerCase();

  const handleExport = async () => {
    setExportError(null);
    setExported(null);
    setIsExporting(true);
    try {
      setExported(await downloadMyData(setExportStep));
    } catch (err) {
      setExportError(err.message);
    } finally {
      setIsExporting(false);
      setExportStep(null);
    }
  };

  const handleClose = async (e) => {
    e.preventDefault();
    setCloseError(null);
    const confirmed = await confirmAction(
      'This deletes your account, your notes and your nook, and cannot ' +
        'be undone. Papers you uploaded stay for the users who have ' +
        'them. Continue?',
      { confirmLabel: 'Delete account', destructive: true },
    );
    if (!confirmed) return;
    setIsClosing(true);
    try {
      await deleteAccount(closeEmail.trim());
      // The session is gone with the account; onLogout clears the token
      // and takes them out to the landing page.
      onLogout();
    } catch (err) {
      setCloseError(err.message);
      setIsClosing(false);
    }
  };

  const handleAvatarFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setProfileError(null);
    setIsAvatarBusy(true);
    try {
      const updated = await uploadAvatar(file);
      onUserUpdated(updated);
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setIsAvatarBusy(false);
      e.target.value = '';
    }
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    setProfileError(null);
    setProfileSaved(false);
    setIsSavingProfile(true);
    try {
      const updated = await updateProfile({
        display_name: displayName.trim(),
        affiliation: affiliation.trim(),
        email_public: emailPublic,
      });
      onUserUpdated(updated);
      setProfileSaved(true);
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSaved(false);
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }
    setIsSavingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordSaved(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordError(err.message);
    } finally {
      setIsSavingPassword(false);
    }
  };

  return (
    <div className="profile-page">
      <ActivityPanel />
      <div className="panel">
        <div className="panel-head-row">
          <h2 className="panel-title">Account</h2>
          <button type="button" onClick={onLogout}>
            Sign out
          </button>
        </div>
        <p className="panel-note">
          These settings are saved to your account and apply wherever you sign in.
        </p>
        <p className="profile-email">
          Signed in as <strong>{user.email}</strong>.
        </p>

        {profileError && <div className="error" role="alert">{profileError}</div>}
        {profileSaved && <div className="success" role="status">Profile updated.</div>}

        <div className="profile-editor">
          <div className="avatar-row">
            <Avatar user={user} className="profile-avatar" />
            <div className="avatar-actions">
              <div className="avatar-buttons">
                <button
                  type="button"
                  onClick={() => avatarFileRef.current?.click()}
                  disabled={isAvatarBusy}
                >
                  {isAvatarBusy
                    ? 'Uploading…'
                    : user.avatar_path
                      ? 'Change image'
                      : 'Upload image'}
                </button>
              </div>
              <p className="avatar-hint">PNG, JPEG, or WebP · 2 MB max.</p>
              <input
                type="file"
                ref={avatarFileRef}
                accept="image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                onChange={handleAvatarFile}
              />
            </div>
          </div>

          <form onSubmit={handleProfileSubmit} className="profile-form">
            <div className="form-group">
              <label htmlFor="profile-display-name">Display name</label>
              <input
                id="profile-display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="profile-affiliation">Affiliation</label>
              <input
                id="profile-affiliation"
                type="text"
                value={affiliation}
                onChange={(e) => setAffiliation(e.target.value)}
                placeholder="University, lab, or company (optional)"
              />
            </div>

            <div className="form-group">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={emailPublic}
                  onChange={(e) => setEmailPublic(e.target.checked)}
                />
                <span>Show my email on my nook</span>
              </label>
            </div>

            <div className="form-actions">
              <button type="submit" className="primary" disabled={isSavingProfile}>
                {isSavingProfile ? 'Saving…' : 'Save profile'}
              </button>
              {/* type="button": inside the profile form, but it reveals the
                  password fields rather than submitting anything. */}
              <button
                type="button"
                onClick={() => setChangingPassword((v) => !v)}
                aria-expanded={changingPassword}
                aria-controls="password-change-form"
              >
                Change password
              </button>
            </div>
          </form>
        </div>

        {changingPassword && (
          <form id="password-change-form" onSubmit={handlePasswordSubmit} className="password-change">
            {passwordError && <div className="error" role="alert">{passwordError}</div>}
            {passwordSaved && <div className="success" role="status">Password updated.</div>}

            <div className="form-group">
              <label htmlFor="current-password">Current password</label>
              <input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="new-password">New password</label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="confirm-password">Confirm new password</label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
              />
            </div>

            <div className="form-actions">
              <button type="submit" className="primary" disabled={isSavingPassword}>
                {isSavingPassword ? 'Saving…' : 'Save new password'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setChangingPassword(false);
                  setCurrentPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                  setPasswordError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {DESKTOP && <LocalDeviceSettings onSynced={onSync} />}

      <MacHandoffSettings />

      {/* Notes you cannot leave with are not really yours. */}
      <div className="panel">
        <h2 className="panel-title">My data</h2>

        {exportError && <div className="error" role="alert">{exportError}</div>}
        {isExporting && (
          <div className="export-progress">
            <ExportWait step={exportStep} />
          </div>
        )}
        {exported && (
          <div className="success" role="status">
            Downloaded — {formatBytes(exported.bytes)}.
          </div>
        )}
        {exported?.failed.length > 0 && (
          <p className="panel-note">
            {exported.failed.length === 1 ? '1 file' : `${exported.failed.length} files`} could not be fetched: {exported.failed.join(', ')}.
          </p>
        )}

        <p className="panel-note">
        A ZIP file containing all your Papol data: your profile, 
        papers and PDFs in your nook, ratings, summaries, notes 
        in both data and readable formats, and seminars you joined.
        </p>

        <div className="form-actions">
          <button onClick={handleExport} disabled={isExporting}>
            {isExporting ? exportLabel(exportStep) : 'Download my data'}
          </button>
        </div>
      </div>

      <div className="panel panel-danger">
        <h2 className="panel-title">Close your account</h2>

        {closeError && <div className="error" role="alert">{closeError}</div>}

        <p className="panel-note" id="close-account-note">
          This permanently deletes your profile, notes, 
          and discussions. It cannot be undone.
          Download your data first if you want to keep it.
        </p>

        <p className="panel-note">
          To confirm, type{' '}
          <span className="confirm-address">{user.email}</span> below.
        </p>

        <form onSubmit={handleClose}>
          <div className="form-group">
            <label htmlFor="close-account-email">Your email address</label>
            <input
              id="close-account-email"
              type="email"
              value={closeEmail}
              onChange={(e) => setCloseEmail(e.target.value)}
              placeholder={user.email}
              autoComplete="off"
              aria-describedby="close-account-note"
              required
            />
          </div>

          <div className="form-actions">
            <button type="submit" className="danger" disabled={isClosing || !closeEmailMatches}>
              {isClosing ? 'Closing…' : 'Delete my account'}
            </button>
          </div>
        </form>
      </div>

    </div>
  );
}

// The export's stages: the data first, then the files, then the zip. Only
// the files are measured — the manifest says how big each one is — so
// that stage is a bar and the other two the spinner. The button that
// started it says the same word.
function exportLabel(step) {
  if (step?.phase === 'fetching') return 'Fetching files';
  if (step?.phase === 'packing') return 'Packing…';
  return 'Gathering…';
}

function ExportWait({ step }) {
  const label = exportLabel(step);
  if (step?.phase !== 'fetching' || !step.totalBytes) return <Working label={label} />;
  const files = formatProgressDetail({ loaded: step.done, total: step.total, unit: 'files' });
  return (
    <Progress
      fraction={progressFraction(step.bytes, step.totalBytes)}
      label={label}
      detail={`${formatProgressDetail({ loaded: step.bytes, total: step.totalBytes })} · ${files}`}
    />
  );
}
