/**
 * Adversarial Security Rules Specification Suite for DEDSEC Firestore Rules
 * Verifies all 12 Dirty Dozen payloads defined in security_spec.md are denied.
 */

export interface DirtyDozenScenario {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  auth: { uid: string; email: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expectedOutcome: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: DirtyDozenScenario[] = [
  {
    id: 1,
    name: 'Shadow Field Injection on UserProfile',
    collectionPath: '/users/user_alpha',
    operation: 'create',
    auth: { uid: 'user_alpha', email: 'alpha@example.com', email_verified: true },
    payload: {
      uid: 'user_alpha',
      displayName: 'Alpha',
      planId: 'free_trial',
      isAdmin: true,
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Self-Assigned Paid Tier on UserProfile Create',
    collectionPath: '/users/user_alpha',
    operation: 'create',
    auth: { uid: 'user_alpha', email: 'alpha@example.com', email_verified: true },
    payload: {
      uid: 'user_alpha',
      displayName: 'Alpha',
      planId: 'studio_pro',
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Unverified Admin Email Spoof',
    collectionPath: '/admins/spoof_uid',
    operation: 'create',
    auth: { uid: 'spoof_uid', email: 'shanmugaragavan07@gmail.com', email_verified: false },
    payload: {
      uid: 'spoof_uid',
      grantedBy: 'bootstrap',
      createdAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Cross-User PII Read',
    collectionPath: '/users/user_alpha/private/info',
    operation: 'get',
    auth: { uid: 'user_bravo', email: 'bravo@example.com', email_verified: true },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Orphaned Subcollection Write Without Parent UserProfile',
    collectionPath: '/users/orphan_uid/private/info',
    operation: 'create',
    auth: { uid: 'orphan_uid', email: 'orphan@example.com', email_verified: true },
    payload: {
      uid: 'orphan_uid',
      email: 'orphan@example.com',
      twoFactorEnabled: false,
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'ID Poisoning with Oversized Invalid Characters',
    collectionPath: `/cases/${'x'.repeat(200)}$$$`,
    operation: 'create',
    auth: { uid: 'user_alpha', email: 'alpha@example.com', email_verified: true },
    payload: {},
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Identity Spoofing on Case Create',
    collectionPath: '/cases/case_01',
    operation: 'create',
    auth: { uid: 'user_alpha', email: 'alpha@example.com', email_verified: true },
    payload: {
      caseId: 'case_01',
      ownerId: 'user_bravo',
      title: 'Composite 01',
      description: 'Adult oval face',
      imageUrl: '/api/images/test.png',
      status: 'saved',
      versionCount: 1,
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Client-Forged Timestamp on Case Create',
    collectionPath: '/cases/case_01',
    operation: 'create',
    auth: { uid: 'user_alpha', email: 'alpha@example.com', email_verified: true },
    payload: {
      caseId: 'case_01',
      ownerId: 'user_alpha',
      title: 'Composite 01',
      description: 'Adult oval face',
      imageUrl: '/api/images/test.png',
      status: 'saved',
      versionCount: 1,
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-01T00:00:00Z',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Immutable Owner Mutation on Case Update',
    collectionPath: '/cases/case_01',
    operation: 'update',
    auth: { uid: 'user_alpha', email: 'alpha@example.com', email_verified: true },
    payload: {
      ownerId: 'user_bravo',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Value Poisoning on Allowed Update Field',
    collectionPath: '/cases/case_01',
    operation: 'update',
    auth: { uid: 'user_alpha', email: 'alpha@example.com', email_verified: true },
    payload: {
      title: 'A'.repeat(10000),
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Terminal State Bypass on Archived Case',
    collectionPath: '/cases/case_archived',
    operation: 'update',
    auth: { uid: 'user_alpha', email: 'alpha@example.com', email_verified: true },
    payload: {
      title: 'Mutated After Archive',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Unscoped List Scraping Across All Cases',
    collectionPath: '/cases',
    operation: 'list',
    auth: { uid: 'user_bravo', email: 'bravo@example.com', email_verified: true },
    expectedOutcome: 'PERMISSION_DENIED',
  },
];
