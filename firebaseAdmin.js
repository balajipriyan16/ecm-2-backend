import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import fs from "fs";

function getFirebaseCredential() {
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
        return cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        });
    }

    const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./serviceAccountKey.json";
    if (fs.existsSync(keyPath)) {
        const fileContent = fs.readFileSync(keyPath, "utf8");
        return cert(JSON.parse(fileContent));
    }

    throw new Error("Firebase service account credentials not found in environment variables or serviceAccountKey.json");
}

const app = getApps().length === 0
    ? initializeApp({
        credential: getFirebaseCredential()
    })
    : getApps()[0];

export const firebaseAuth = getAuth(app);