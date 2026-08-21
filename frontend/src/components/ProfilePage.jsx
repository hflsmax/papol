import React, { useState, useRef } from 'react';
import {
  updateProfile,
  changePassword,
  uploadAvatar,
  deleteAvatar,
  downloadMyData,
  deleteAccount,
} from '../api';
import Avatar from './Avatar';

export default function ProfilePage({ user, onUserUpdated, onLogout }) {
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

  const [closePassword, setClosePassword] = useState('');
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
      setCloseError('That is not the email address of this account.');
      return;
    }
    if (
      !confirm(
        'This deletes your account, your notes and your nook, and cannot ' +
          'be undone. Papers you uploaded stay for the readers who have ' +
          'them. Continue?'
      )
    ) {
      return;
    }
    setIsClosing(true);
    try {
      await deleteAccount(closePassword, closeEmail.trim());
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

  const handleAvatarRemove = async () => {
    setProfileError(null);
    setIsAvatarBusy(true);
    try {
      const updated = await deleteAvatar();
      onUserUpdated(updated);
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setIsAvatarBusy(false);
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
          <h2 className="panel-title">Profile</h2>
          {onLogout && (
            <button type="button" onClick={onLogout}>
              Sign out
            </button>
          )}
        </div>
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
              {user.avatar_path && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={handleAvatarRemove}
                  disabled={isAvatarBusy}
                >
                  Remove
                </button>
              )}
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
          A zip of everything Papol holds about you: your profile, the papers
          in your nook with your ratings and summaries, every note you have
          written — as data and as a document you can read — the seminars you
          joined, and the PDF of each paper in your nook.
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
          This removes your profile, your notes, the papers in your nook and
          your notifications. It cannot be undone.
        </p>
        <p className="panel-note">
          Two things stay, because they are no longer only yours. A PDF you
          uploaded remains for the readers who have that paper. What you said
          in a seminar stays where you said it, under “A former reader” — and
          a seminar you were hosting passes to someone else in the cohort, or
          opens again for another reader to host, so that it is not left
          stranded without one.
        </p>
        <p className="panel-note">
          Download your data first if you want to keep it.
        </p>

        <form onSubmit={handleClose}>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={closePassword}
              onChange={(e) => setClosePassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <div className="form-group">
            <label>
              Type <b>{user.email}</b> to confirm
            </label>
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
