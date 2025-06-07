import admin from 'firebase-admin';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';

// Resolve __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to your service account JSON
const jsonPath = path.join(__dirname, './keys/firebase-admin.json');

// Read and parse the service account key
const serviceAccountRaw = await readFile(jsonPath, 'utf-8');
const serviceAccount = JSON.parse(serviceAccountRaw);

// Ensure the private key has proper line breaks
serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

// Extract project ID from the JSON or fallback to env var
const projectId = serviceAccount.project_id || process.env.FIREBASE_PROJECT_ID;

// Initialize the Admin SDK once
if (!admin.apps.length) {

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId, // explicitly set project ID to avoid 'undefined'
  });
}

const db = admin.firestore();

// Confirm the project in logs
console.log('🚀 Firestore connected to project:', admin.app().options.projectId);
console.log('🌐 Firestore emulator host:', process.env.FIRESTORE_EMULATOR_HOST || '(none)');

export { admin, db };