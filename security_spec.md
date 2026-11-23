# Security Specification — Shawarma Cafe POS

## 1. Core Data Invariants
1. **Strict Identity & Role Integrity**: Users cannot self-assign `SUPER_ADMIN`, `MANAGER`, `CASHIER`, or `KITCHEN_STAFF` roles on `users/{userId}` creation unless they match the verified bootstrap owner email (`ehaztechno@gmail.com`) or an active `staff_invites/{email}` record created by an authorized Admin/Manager.
2. **No Shadow Fields**: Every collection uses `keys().hasAll([...])` and `keys().hasOnly([...])` in `isValid[Entity]()` and `affectedKeys().hasOnly([...])` on every update action.
3. **Path Variable & Payload Size Hardening**: All document IDs are validated via `isValidId()` (`^[a-zA-Z0-9_\\-]+$`, max 128 chars). Every string and bounded array enforces explicit `.size()` limits.
4. **Immutable Financial & Audit History**: `payments`, `stock_movements`, and `audit_logs` cannot be deleted. Cancelled orders preserve historical prices and require a `cancelReason` (`status` transitions to `CANCELLED`). Terminal order states (`COMPLETED`, `CANCELLED`) lock out non-admin mutations.
5. **PII Isolation**: Customer profiles (`customers`) and staff accounts (`users`, `staff_invites`) cannot be listed or read by unauthenticated or unauthorized users.
6. **Temporal Integrity**: `createdAt` is validated against `request.time` on creation and immutable on update; `updatedAt` is validated against `request.time` on updates.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Self-Role Escalation (`users`)**: Attacker sends `{ uid: attackerUid, email: "attacker@gmail.com", role: "SUPER_ADMIN", isActive: true }` -> **REJECTED** (`PERMISSION_DENIED`).
2. **Shadow Field Injection (`orders`)**: Attacker sends valid order fields plus `isApprovedBypass: true` -> **REJECTED** by `hasOnly(...)`.
3. **Email Spoofing (`categories`)**: Token with `email: "ehaztechno@gmail.com"` and `email_verified: false` -> **REJECTED** by `isVerified()`.
4. **ID Poisoning (`products`)**: Document ID `../../admin` or 2KB string -> **REJECTED** by `isValidId(productId)`.
5. **Unbounded Array / Resource Exhaustion (`products`)**: `addonGroupIds` with 50 items -> **REJECTED** (`size() <= 10`).
6. **Timestamp Forgery (`orders`)**: Client supplies `createdAt: "2020-01-01T00:00:00Z"` instead of `serverTimestamp()` -> **REJECTED** (`incoming().createdAt == request.time`).
7. **Immutable Field Tampering (`orders`)**: Update attempts to change `createdByUid` or `orderNumber` -> **REJECTED** (`incoming().createdByUid == existing().createdByUid`).
8. **Terminal State Mutation (`orders`)**: Non-admin attempts to edit `grandTotal` on a `COMPLETED` or `CANCELLED` order -> **REJECTED** by terminal state lock.
9. **Audit Log Erasure (`audit_logs`)**: Attempt to `update` or `delete` an audit log -> **REJECTED** (`allow update, delete: if false`).
10. **Payment Ledger Deletion (`payments`)**: Attempt to `delete` a completed payment record -> **REJECTED** (`allow delete: if false`).
11. **PII Scraping (`customers`)**: Random signed-in user attempts `list` on `/customers` -> **REJECTED** (not owner/staff/super-admin).
12. **Type Poisoning on Update (`tables`)**: Attempt to update `tables/{id}` setting `capacity: "ten"` or `status: "HACKED"` -> **REJECTED** by `isValidRestaurantTable(incoming())`.
