import { google } from "googleapis";
import fs from "fs";

// One service account, two scopes: read the product sheet, and read the
// Drive files (product photos) it links to. Read-only scopes on purpose —
// this process should never be able to modify your Sheet or Drive, only
// your own product database.
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

let cachedAuth = null;

export function isSheetsSyncConfigured() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE && process.env.SHEETS_SYNC_SHEET_ID);
}

function loadCredentials() {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  if (!keyFile) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_KEY_FILE is not set in server/.env — see server/sync/README-SHEETS-SYNC.md for setup."
    );
  }
  if (!fs.existsSync(keyFile)) {
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_KEY_FILE points to "${keyFile}", but that file doesn't exist.`);
  }
  return JSON.parse(fs.readFileSync(keyFile, "utf-8"));
}

export function getGoogleAuth() {
  if (cachedAuth) return cachedAuth;
  const credentials = loadCredentials();
  cachedAuth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  return cachedAuth;
}

export function getSheetsClient() {
  return google.sheets({ version: "v4", auth: getGoogleAuth() });
}

export function getDriveClient() {
  return google.drive({ version: "v3", auth: getGoogleAuth() });
}
