# DEDSEC Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Default Deny**: Any path not explicitly matched (`/users/{userId}`, `/users/{userId}/private/{docId}`, `/admins/{adminId}`, `/cases/{caseId}`) must be rejected unconditionally.
2. **Verified Identity**: All client writes require `request.auth != null` and `request.auth.token.email_verified == true`.
3. **PII Isolation**: Email addresses live exclusively in `/users/{userId}/private/{docId}` (where `docId == 'info'`) and can only be read or written by the exact owner (`request.auth.uid == userId`) or a verified administrator, and only when the parent `/users/{userId}` document exists.
4. **Privilege Escalation Prevention**: Regular users cannot create `/admins/{adminId}` documents or upgrade their own `planId` above `'free_trial'` via client SDK writes; plan upgrades require admin/server authorization.
5. **Relational & Temporal Integrity**: Every `CaseMetadata` write must have `ownerId == request.auth.uid`, an existing `/users/$(request.auth.uid)` profile, immutable `createdAt`/`ownerId`/`caseId`, and server-enforced `request.time` timestamps.
6. **Terminal Archive Locking**: Once a case reaches `status == 'archived'`, non-admin updates are blocked.
7. **Secure List Queries**: `allow list` on `/cases/{caseId}` enforces `resource.data.ownerId == request.auth.uid || isAdmin()` without performing `get()`/`exists()` inside `list`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Shadow Field Injection**: Creating `/users/u1` with extra key `"isAdmin": true`.
2. **Self-Assigned Paid Tier**: Creating `/users/u1` with `"planId": "studio_pro"` as a non-admin.
3. **Unverified Email Spoof**: Accessing `/admins` with matching admin email string but `email_verified: false`.
4. **Cross-User PII Read**: Authenticated user `u2` attempting `get` on `/users/u1/private/info`.
5. **Orphaned Subcollection Write**: Writing `/users/u1/private/info` when parent `/users/u1` does not exist.
6. **ID Poisoning**: Creating `/cases/<200-char-junk-id>` violating `isValidId()`.
7. **Identity Spoofing on Case Create**: User `u1` creating `/cases/c1` with `"ownerId": "u2"`.
8. **Client-Forged Timestamp**: Creating `/cases/c1` with past/future `createdAt` != `request.time`.
9. **Immutable Owner Mutation**: Updating `/cases/c1` to transfer `ownerId` to another user.
10. **Value Poisoning on Update**: Updating allowed key `title` on `/cases/c1` with a 10,000-char string or boolean.
11. **Terminal State Bypass**: Updating `/cases/c1` title when existing `status == 'archived'` as non-admin.
12. **Unscoped List Scraping**: Querying `collection(db, 'cases')` without `where('ownerId', '==', uid)`.
