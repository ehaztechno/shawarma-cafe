import React, { useState } from 'react';
import { Shield, UserPlus } from 'lucide-react';
import { usePos } from '../context/PosContext';
import { formatTimestamp, ROLE_LABELS, ROLE_PERMISSIONS } from '../lib/permissions';
import { updateUserRole, upsertStaffInvite } from '../lib/posService';
import { StaffRole } from '../types/pos';

export const StaffRolesView: React.FC = () => {
  const {
    staffUsers,
    staffInvites,
    auditLogs,
    activeRole,
    firebaseUser,
    notify,
  } = usePos();

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Exclude<StaffRole, 'PENDING'>>('CASHIER');
  const [tab, setTab] = useState<'directory' | 'roles' | 'audit'>('directory');

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !email.trim() || !displayName.trim()) return;
    const normalized = email.trim().toLowerCase();
    const existing = staffInvites.some((i) => i.email === normalized);
    try {
      await upsertStaffInvite({
        email: normalized,
        displayName,
        role,
        isActive: true,
        isNew: !existing,
        actorUid: firebaseUser.uid,
      });
      setEmail('');
      setDisplayName('');
      notify(`Staff access ${existing ? 'updated' : 'assigned'} for ${normalized}.`, 'success');
    } catch (err: any) {
      notify(err?.message || 'Unable to save staff invite.', 'error');
    }
  };

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-stone-900 dark:text-stone-100">
            Staff, Roles &amp; Audit Logs
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Manage Google-authenticated POS cashiers, kitchen staff, managers, and security trail
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-lg text-xs">
          {(
            [
              { id: 'directory', label: 'Staff Directory' },
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
            onSubmit={handleInvite}
            className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-5 space-y-3 h-fit"
          >
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-orange-600" />
              Authorize Staff Google Email
            </h3>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@gmail.com"
              className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Staff Full Name"
              className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
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
            <button
              type="submit"
              className="w-full min-h-[40px] rounded-lg bg-orange-600 text-white font-semibold hover:bg-orange-700 cursor-pointer"
            >
              Assign Role
            </button>
          </form>

          <div className="lg:col-span-2 space-y-4">
            {/* Active Signed-in Users (Super Admin view) */}
            {staffUsers.length > 0 && (
              <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-stone-200 dark:border-stone-800 font-semibold">
                  Registered Staff Accounts
                </div>
                <table className="w-full text-left">
                  <thead className="bg-stone-50 dark:bg-stone-800/50 text-stone-500 border-b border-stone-200 dark:border-stone-800">
                    <tr>
                      <th className="py-2.5 px-4">Staff Member</th>
                      <th className="py-2.5 px-4">Role</th>
                      <th className="py-2.5 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                    {staffUsers.map((u) => (
                      <tr key={u.id}>
                        <td className="py-2.5 px-4">
                          <p className="font-semibold">{u.displayName}</p>
                          <p className="text-[11px] text-stone-500">{u.email}</p>
                        </td>
                        <td className="py-2.5 px-4">
                          <select
                            disabled={u.uid === firebaseUser?.uid}
                            value={u.role}
                            onChange={async (e) => {
                              try {
                                await updateUserRole({
                                  uid: u.uid,
                                  displayName: u.displayName,
                                  role: e.target.value as StaffRole,
                                  isActive: e.target.value !== 'PENDING',
                                });
                                notify(`Updated role for ${u.displayName}.`, 'success');
                              } catch (err: any) {
                                notify(err?.message || 'Unable to update role.', 'error');
                              }
                            }}
                            className="min-h-[32px] px-2 rounded border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
                          >
                            <option value="SUPER_ADMIN">Super Admin</option>
                            <option value="MANAGER">Manager</option>
                            <option value="CASHIER">Cashier</option>
                            <option value="KITCHEN_STAFF">Kitchen Staff</option>
                            <option value="PENDING">Pending</option>
                          </select>
                        </td>
                        <td className="py-2.5 px-4">
                          <button
                            type="button"
                            disabled={u.uid === firebaseUser?.uid}
                            onClick={async () => {
                              try {
                                await updateUserRole({
                                  uid: u.uid,
                                  displayName: u.displayName,
                                  role: u.role,
                                  isActive: !u.isActive,
                                });
                                notify(
                                  `${u.displayName} ${!u.isActive ? 'activated' : 'suspended'}.`,
                                  'info'
                                );
                              } catch (err: any) {
                                notify(err?.message || 'Unable to update status.', 'error');
                              }
                            }}
                            className={`font-semibold ${
                              u.isActive ? 'text-emerald-600' : 'text-red-600'
                            }`}
                          >
                            {u.isActive ? 'Active' : 'Suspended'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-stone-200 dark:border-stone-800 font-semibold">
                Pre-Authorized Staff Invites
              </div>
              <table className="w-full text-left">
                <thead className="bg-stone-50 dark:bg-stone-800/50 text-stone-500 border-b border-stone-200 dark:border-stone-800">
                  <tr>
                    <th className="py-2.5 px-4">Name</th>
                    <th className="py-2.5 px-4">Google Email</th>
                    <th className="py-2.5 px-4">Role</th>
                    <th className="py-2.5 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {staffInvites.map((inv) => (
                    <tr key={inv.id}>
                      <td className="py-2.5 px-4 font-semibold">{inv.displayName}</td>
                      <td className="py-2.5 px-4">{inv.email}</td>
                      <td className="py-2.5 px-4">{ROLE_LABELS[inv.role]}</td>
                      <td className="py-2.5 px-4">
                        {inv.isActive ? 'Enabled' : 'Disabled'}
                      </td>
                    </tr>
                  ))}
                  {staffInvites.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-stone-500">
                        No staff invites added yet. Use the form on the left to invite Cashiers or Kitchen Staff.
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
    </div>
  );
};
