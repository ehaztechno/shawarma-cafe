import React, { useState } from 'react';
import { KeyRound, Shield, Trash2, UserPlus, X } from 'lucide-react';
import { usePos } from '../context/PosContext';
import { formatTimestamp, ROLE_LABELS, ROLE_PERMISSIONS } from '../lib/permissions';
import {
  createStaffAccount,
  deleteStaffAccount,
  resetStaffPassword,
  updateUserRole,
} from '../lib/posService';
import { StaffRole, UserProfile } from '../types/pos';

export const StaffRolesView: React.FC = () => {
  const {
    staffUsers,
    auditLogs,
    activeRole,
    firebaseUser,
    refreshPosState,
    notify,
  } = usePos();

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Exclude<StaffRole, 'PENDING'>>('CASHIER');
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState<'directory' | 'roles' | 'audit'>('directory');

  const [resetTarget, setResetTarget] = useState<UserProfile | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !username.trim() || !displayName.trim() || !password) return;
    setSubmitting(true);
    try {
      await createStaffAccount({
        username: username.trim().toLowerCase(),
        displayName: displayName.trim(),
        password,
        role,
      });
      setUsername('');
      setDisplayName('');
      setPassword('');
      await refreshPosState();
      notify(`Staff login "${username.trim().toLowerCase()}" created.`, 'success');
    } catch (err: any) {
      notify(err?.message || 'Unable to create staff account.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget || newPassword.length < 4) return;
    try {
      await resetStaffPassword({ uid: resetTarget.uid, password: newPassword });
      notify(`Password updated for @${resetTarget.username || resetTarget.email}.`, 'success');
      setResetTarget(null);
      setNewPassword('');
    } catch (err: any) {
      notify(err?.message || 'Unable to reset password.', 'error');
    }
  };

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-stone-900 dark:text-stone-100">
            Staff Logins, Roles &amp; Audit Logs
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Create username &amp; password accounts for cashiers, kitchen staff, and managers
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-lg text-xs">
          {(
            [
              { id: 'directory', label: 'Staff Accounts' },
              { id: 'roles', label: 'Role Permissions' },
              { id: 'audit', label: 'Audit Trail' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-md font-semibold cursor-pointer ${
                tab === t.id
                  ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-sm'
                  : 'text-stone-600 dark:text-stone-400'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'directory' && (
        <div className="grid lg:grid-cols-3 gap-6 text-xs">
          <form
            onSubmit={handleCreateStaff}
            className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-5 space-y-3 h-fit"
          >
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-orange-600" />
              Create Staff Login
            </h3>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-stone-500">Username</label>
              <input
                type="text"
                required
                minLength={3}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. cashier1 or kitchen1"
                className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-stone-500">Full Name</label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Staff Full Name"
                className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-stone-500">Password</label>
              <input
                type="password"
                required
                minLength={4}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 4 characters"
                className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-stone-500">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
              >
                <option value="CASHIER">Cashier</option>
                <option value="KITCHEN_STAFF">Kitchen Staff</option>
                <option value="MANAGER">Manager</option>
                {activeRole === 'SUPER_ADMIN' && <option value="SUPER_ADMIN">Super Admin</option>}
              </select>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[40px] rounded-lg bg-orange-600 text-white font-semibold hover:bg-orange-700 disabled:opacity-60 cursor-pointer"
            >
              {submitting ? 'Creating...' : 'Create Staff Account'}
            </button>
          </form>

          <div className="lg:col-span-2 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-200 dark:border-stone-800 font-semibold">
              Staff Accounts ({staffUsers.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-stone-50 dark:bg-stone-800/50 text-stone-500 border-b border-stone-200 dark:border-stone-800">
                  <tr>
                    <th className="py-2.5 px-4">Staff Member</th>
                    <th className="py-2.5 px-4">Role</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {staffUsers.map((u) => {
                    const isSelf = u.uid === firebaseUser?.uid;
                    const uname = u.username || u.email;
                    return (
                      <tr key={u.id}>
                        <td className="py-2.5 px-4">
                          <p className="font-semibold">{u.displayName}</p>
                          <p className="text-[11px] font-mono-num text-stone-500">@{uname}</p>
                        </td>
                        <td className="py-2.5 px-4">
                          <select
                            disabled={isSelf}
                            value={u.role}
                            onChange={async (e) => {
                              try {
                                await updateUserRole({
                                  uid: u.uid,
                                  displayName: u.displayName,
                                  role: e.target.value as StaffRole,
                                  isActive: e.target.value !== 'PENDING',
                                });
                                await refreshPosState();
                                notify(`Updated role for ${u.displayName}.`, 'success');
                              } catch (err: any) {
                                notify(err?.message || 'Unable to update role.', 'error');
                              }
                            }}
                            className="min-h-[32px] px-2 rounded border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 disabled:opacity-60"
                          >
                            <option value="SUPER_ADMIN">Super Admin</option>
                            <option value="MANAGER">Manager</option>
                            <option value="CASHIER">Cashier</option>
                            <option value="KITCHEN_STAFF">Kitchen Staff</option>
                          </select>
                        </td>
                        <td className="py-2.5 px-4">
                          <button
                            type="button"
                            disabled={isSelf}
                            onClick={async () => {
                              try {
                                await updateUserRole({
                                  uid: u.uid,
                                  displayName: u.displayName,
                                  role: u.role,
                                  isActive: !u.isActive,
                                });
                                await refreshPosState();
                                notify(
                                  `${u.displayName} ${!u.isActive ? 'activated' : 'suspended'}.`,
                                  'info'
                                );
                              } catch (err: any) {
                                notify(err?.message || 'Unable to update status.', 'error');
                              }
                            }}
                            className={`font-semibold cursor-pointer disabled:opacity-60 ${
                              u.isActive ? 'text-emerald-600' : 'text-red-600'
                            }`}
                          >
                            {u.isActive ? 'Active' : 'Suspended'}
                          </button>
                        </td>
                        <td className="py-2.5 px-4 text-right space-x-2">
                          <button
                            type="button"
                            onClick={() => {
                              setResetTarget(u);
                              setNewPassword('');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
                          >
                            <KeyRound className="w-3 h-3" />
                            Reset Password
                          </button>
                          {activeRole === 'SUPER_ADMIN' && !isSelf && (
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await deleteStaffAccount(u.uid);
                                  await refreshPosState();
                                  notify(`Removed @${uname}.`, 'info');
                                } catch (err: any) {
                                  notify(err?.message || 'Unable to delete account.', 'error');
                                }
                              }}
                              className="inline-flex items-center p-1.5 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                              title="Remove account"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {staffUsers.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-stone-500">
                        No staff accounts found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'roles' && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          {(['SUPER_ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN_STAFF'] as const).map((code) => (
            <div
              key={code}
              className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-5 space-y-3"
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                <Shield className="w-4 h-4 text-orange-600" />
                {ROLE_LABELS[code]}
              </div>
              <ul className="space-y-1.5 text-stone-600 dark:text-stone-400">
                {ROLE_PERMISSIONS[code].map((perm) => (
                  <li key={perm} className="font-mono-num text-[11px]">
                    · {perm.replace(/_/g, ' ')}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {tab === 'audit' && (
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden text-xs">
          <table className="w-full text-left">
            <thead className="bg-stone-50 dark:bg-stone-800/50 text-stone-500 border-b border-stone-200 dark:border-stone-800">
              <tr>
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Actor</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {auditLogs.slice(0, 80).map((log) => (
                <tr key={log.id}>
                  <td className="py-2.5 px-4 text-stone-500">
                    {formatTimestamp(log.createdAt)}
                  </td>
                  <td className="py-2.5 px-4">
                    <span className="font-semibold">{log.actorEmail}</span>
                    <span className="text-stone-400 ml-1">({log.actorRole})</span>
                  </td>
                  <td className="py-2.5 px-4 font-mono-num font-semibold">{log.action}</td>
                  <td className="py-2.5 px-4 text-stone-700 dark:text-stone-300">
                    {log.summary}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {resetTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleResetPassword}
            className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl max-w-sm w-full p-5 space-y-4 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">
                Reset Password (@{resetTarget.username || resetTarget.email})
              </h3>
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="p-1 text-stone-500 hover:text-stone-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="password"
              required
              minLength={4}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password (min 4 chars)"
              className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-orange-600 text-white font-semibold hover:bg-orange-700 cursor-pointer"
              >
                Save Password
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
