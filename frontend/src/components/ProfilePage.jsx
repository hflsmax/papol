import React, { useState, useRef } from 'react';
import { updateProfile, changePassword, uploadAvatar, deleteAvatar } from '../api';
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

  const [isAvatarBusy, setIsAvatarBusy] = useState(false);
  const avatarFileRef = useRef(null);

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
          </div>
        </form>
      </div>

      <div className="panel">
        <h2 className="panel-title">Change password</h2>

        {passwordError && <div className="error">{passwordError}</div>}
        {passwordSaved && <div className="success">Password updated.</div>}

        <form onSubmit={handlePasswordSubmit}>
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
              {isSavingPassword ? 'Saving…' : 'Change password'}
            </button>
          </div>
        </form>
      </div>

    </div>
  );
}
