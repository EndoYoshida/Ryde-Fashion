import { google } from "googleapis";
import fs from "fs";

// One service account, two scopes: read/write the product sheet (the
// pull sync still only *reads* it — the write scope is only ever used to
// push a single stock number back after a checkout, see
// sheetsSync.js#writeStockToSheet), and read/write the Drive files
// (product photos) it links to. Drive used to be read-only, but it's now
// read/write so a deleted product/row can also trash its source photo in
// Drive (see driveImages.js#trashDriveFile) — the service account still
// only ever touches files it can already read (the shared product-photos
// folder), never anything else in the owner's Drive.
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
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
