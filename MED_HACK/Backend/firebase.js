import admin from 'firebase-admin';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const jsonPath = path.join(__dirname, './keys/firebase-admin.json');

// ✅ Read JSON manually and parse it
const serviceAccountRaw = await readFile(jsonPath, 'utf-8');
const serviceAccount = JSON.parse(serviceAccountRaw);

// 🔐 Fix PEM format
serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();
const auth = admin.auth();

export { admin, db, auth };
