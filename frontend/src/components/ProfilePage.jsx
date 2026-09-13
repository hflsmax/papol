import React, { useEffect, useState, useRef } from 'react';
import {
  updateProfile,
  changePassword,
  uploadAvatar,
  downloadMyData,
  deleteAccount,
} from '../api';
import Avatar from './Avatar';
import { confirmAction } from '../../../shared/confirmAction';
import { DESKTOP, MAC } from '../../../shared/desktopShell';
import {
  getLocalSyncPreference,
  setLocalSyncPreference,
} from '../../../shared/offlineStore';
import {
  clearNativeData, hydrateNativeSyncPreference, makePdfViewerDefault, nativeStorageStatus,
  openNativeStorageInFinder, pdfViewerStatus, persistNativeSyncPreference, subscribeNativeData,
  subscribeNativeSyncProgress, syncAllNow,
} from '../nativeData';

const SYNC_PHASES = {
  uploading: 'Sending changes',
  snapshot: 'Checking library',
  pulling: 'Receiving changes',
  downloading: 'Downloading files',
};

function syncProgressLabel(progress) {
  if (!progress) return 'Starting…';
  const label = SYNC_PHASES[progress.phase] || 'Syncing';
  if (!progress.total) return label;
  return `${label} · ${Math.min(progress.completed + 1, progress.total)} of ${progress.total}`;
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
        <strong>PDF viewer</strong>
        <div className={`local-storage-totals${error ? ' error' : ''}`}>
          {error || (status.is_default ? 'PDFs open in Papol.' : 'PDFs open in another app.')}
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
  const [sync, setSync] = useState({ running: false, progress: null, error: null, lastBytes: null });

  useEffect(() => {
    hydrateNativeSyncPreference().then(setSyncPreferenceState).catch(() => {});
    nativeStorageStatus().then(setStorage).catch(() => {});
    const stopProgress = subscribeNativeSyncProgress((progress) => {
      setSync((current) => ({ ...current, running: true, error: null, progress }));
    });
    const stopStatus = subscribeNativeData((payload) => {
      if (payload?.syncing === true) {
        setSync((current) => ({ ...current, running: true, error: null, progress: null }));
      } else if (payload?.syncing === false) {
        setSync((current) => ({
          ...current,
          running: false,
          progress: null,
          lastBytes: current.progress?.bytes ?? current.lastBytes,
        }));
        nativeStorageStatus().then(setStorage).catch(() => {});
      } else if (typeof payload?.error === 'string') {
        setSync((current) => ({ ...current, error: payload.error }));
      }
    });
    return () => {
      stopProgress();
      stopStatus();
    };
  }, []);

  const syncNow = async () => {
    setSync((current) => ({ ...current, running: true, error: null, progress: null }));
    const failure = await syncAllNow();
    setSync((current) => ({ ...current, running: false, progress: null, error: failure }));
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
      setStorage(await nativeStorageStatus());
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

  return (
    <div className="panel local-settings-panel">
      <h2 className="panel-title">Settings</h2>
      <div className="local-setting-row">
        <label htmlFor="local-sync-preference"><strong>Sync</strong></label>
        <div className="local-sync-actions">
          <select
            id="local-sync-preference"
            value={syncPreference}
            onChange={(event) => chooseSyncPreference(event.target.value)}
          >
            <option value="automatic">Automatic</option>
            <option value="manual">Manual</option>
          </select>
          <button type="button" disabled={sync.running} onClick={syncNow}>
            {sync.running ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </div>
      {sync.running && (
        <div className="local-sync-progress">
          <div
            className="local-sync-bar"
            role="progressbar"
            aria-label="Sync progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((sync.progress?.fraction || 0) * 100)}
          >
            <span style={{ width: `${(sync.progress?.fraction || 0) * 100}%` }} />
          </div>
          <div className="local-sync-detail">
            <span>{syncProgressLabel(sync.progress)}</span>
            {sync.progress && (
              <span className="local-sync-speed">
                {formatSize(Math.round(sync.progress.bytes_per_second))}/s
                {' · '}
                {formatSize(sync.progress.bytes)}
              </span>
            )}
          </div>
        </div>
      )}
      {!sync.running && (sync.error || sync.lastBytes != null) && (
        <div className={`local-sync-detail${sync.error ? ' error' : ''}`} role="status">
          {sync.error || `Sync finished · ${formatSize(sync.lastBytes)} transferred`}
        </div>
      )}
      <PdfViewerSetting />
      {storage && (
        <div className="local-setting-row local-storage-row">
          <div>
            <strong>Storage</strong>
            <div className="local-storage-totals">
              {formatSize(storage.classes.unsynced.bytes)} unsynced ·{' '}
              {formatSize(storage.classes.cache.bytes)} cache
            </div>
            {storageError && <div className="local-storage-totals error">{storageError}</div>}
          </div>
          <div className="local-storage-actions">
            {MAC && <button type="button" onClick={openStorage}>Open in Finder</button>}
            <button
              type="button"
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
  // backend and the resulting values follow the reader to every device.
  const [displayName, setDisplayName] = useState(user.display_name);
  const [affiliation, setAffiliation] = useState(user.affiliation || '');
  const [emailPublic, setEmailPublic] = useState(user.email_public !== false);
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
  const [exportedBytes, setExportedBytes] = useState(null);

  const [closeEmail, setCloseEmail] = useState('');
  const [closeError, setCloseError] = useState(null);
  const [isClosing, setIsClosing] = useState(false);

  const handleExport = async () => {
    setExportError(null);
    setExportedBytes(null);
    setIsExporting(true);
    try {
      setExportedBytes(await downloadMyData());
    } catch (err) {
      setExportError(err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const handleClose = async (e) => {
    e.preventDefault();
    setCloseError(null);
    // The typed email and the password are checked on the server too; this
    // only saves a round trip and says which one is wrong.
    if (closeEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
      setCloseError("Email doesn't match this account.");
      return;
    }
    const confirmed = await confirmAction(
      'This deletes your account, your notes and your nook, and cannot ' +
        'be undone. Papers you uploaded stay for the readers who have ' +
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
      <div className="panel">
        <div className="panel-head-row">
          <h2 className="panel-title">Account</h2>
          {onLogout && (
            <button type="button" onClick={onLogout}>
              Sign out
            </button>
          )}
        </div>
        <p className="panel-note">
          These settings are saved to your account and apply wherever you sign in.
        </p>
        <p className="profile-email">
          Signed in as <strong>{user.email}</strong>.
        </p>

        {profileError && <div className="error">{profileError}</div>}
        {profileSaved && <div className="success">Profile updated.</div>}

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
                  ? 'Working…'
                  : user.avatar_path
                    ? 'Change image'
                    : 'Upload image'}
              </button>
            </div>
            <p className="avatar-hint">PNG, JPEG, or WebP, up to 2 MB.</p>
            <input
              type="file"
              ref={avatarFileRef}
              accept="image/png,image/jpeg,image/webp"
              style={{ display: 'none' }}
              onChange={handleAvatarFile}
            />
          </div>
        </div>

        <form onSubmit={handleProfileSubmit}>
          <div className="form-group">
            <label>Display name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label>Affiliation</label>
            <input
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
            >
              Change password
            </button>
          </div>
        </form>

        {changingPassword && (
          <form onSubmit={handlePasswordSubmit} className="password-change">
            {passwordError && <div className="error">{passwordError}</div>}
            {passwordSaved && <div className="success">Password updated.</div>}

            <div className="form-group">
              <label>Current password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <div className="form-group">
              <label>New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
              />
            </div>

            <div className="form-group">
              <label>Confirm new password</label>
              <input
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

      {/* Notes you cannot leave with are not really yours. */}
      <div className="panel">
        <h2 className="panel-title">Your things</h2>

        {exportError && <div className="error">{exportError}</div>}
        {exportedBytes != null && (
          <div className="success">
            Downloaded — {formatSize(exportedBytes)}.
          </div>
        )}

        <p className="panel-note">
        A ZIP file containing all your Papol data: your profile, 
        papers and PDFs in your nook, ratings, summaries, notes 
        in both data and readable formats, and seminars you joined.
        </p>

        <div className="form-actions">
          <button onClick={handleExport} disabled={isExporting}>
            {isExporting ? 'Gathering it up…' : 'Download my data'}
          </button>
        </div>
      </div>

      <div className="panel panel-danger">
        <h2 className="panel-title">Close your account</h2>

        {closeError && <div className="error">{closeError}</div>}

        <p className="panel-note">
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
            <label>Your email address</label>
            <input
              type="email"
              value={closeEmail}
              onChange={(e) => setCloseEmail(e.target.value)}
              placeholder={user.email}
              autoComplete="off"
              required
            />
          </div>

          <div className="form-actions">
            <button type="submit" className="danger" disabled={isClosing}>
              {isClosing ? 'Closing…' : 'Delete my account'}
            </button>
          </div>
        </form>
      </div>

    </div>
  );
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
