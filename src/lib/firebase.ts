import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: boolean | string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore on application boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export async function signInWithGooglePopup(): Promise<FirebaseUser> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  const user = cred.user;

  // Sync verified profile and isolated PII record to Firestore
  if (user.emailVerified && user.email) {
    const safeUid = user.uid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
    const displayName = (user.displayName || user.email.split('@')[0] || 'Investigator').slice(0, 100);
    const userPath = `users/${safeUid}`;
    try {
      const existingSnap = await getDoc(doc(db, 'users', safeUid));
      if (!existingSnap.exists()) {
        await setDoc(doc(db, 'users', safeUid), {
          uid: safeUid,
          displayName,
          planId: 'free_trial',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await setDoc(doc(db, 'users', safeUid, 'private', 'info'), {
          uid: safeUid,
          email: user.email.slice(0, 254),
          twoFactorEnabled: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, 'users', safeUid), {
          displayName,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, userPath);
    }
  }

  return user;
}

export async function syncCaseMetadataToFirestore(params: {
  caseId: string;
  title: string;
  description: string;
  imageUrl: string;
  status: 'draft' | 'saved' | 'archived';
  versionCount: number;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return;

  const safeCaseId = params.caseId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
  const safeOwnerId = currentUser.uid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
  const casePath = `cases/${safeCaseId}`;

  try {
    const snap = await getDoc(doc(db, 'cases', safeCaseId));
    if (!snap.exists()) {
      await setDoc(doc(db, 'cases', safeCaseId), {
        caseId: safeCaseId,
        ownerId: safeOwnerId,
        title: (params.title || 'Untitled Composite').slice(0, 160),
        description: (params.description || '').slice(0, 4000),
        imageUrl: (params.imageUrl || '').slice(0, 512),
        status: params.status,
        versionCount: Math.max(0, Math.min(500, Math.floor(params.versionCount))),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (snap.data()?.status !== 'archived') {
      await updateDoc(doc(db, 'cases', safeCaseId), {
        title: (params.title || 'Untitled Composite').slice(0, 160),
        description: (params.description || '').slice(0, 4000),
        imageUrl: (params.imageUrl || '').slice(0, 512),
        status: params.status,
        versionCount: Math.max(0, Math.min(500, Math.floor(params.versionCount))),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, casePath);
  }
}

export async function deleteCaseMetadataFromFirestore(caseId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return;

  const safeCaseId = caseId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
  const casePath = `cases/${safeCaseId}`;
  try {
    const snap = await getDoc(doc(db, 'cases', safeCaseId));
    if (snap.exists()) {
      await deleteDoc(doc(db, 'cases', safeCaseId));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, casePath);
  }
}

export { firebaseSignOut, onAuthStateChanged };
export type { FirebaseUser };
