// Paste this into Google Apps Script, deploy as a Web App,
// then paste the deployed /exec URL into Coupon Seva Tracker setup.
//
// You can paste either the full Google Sheet URL or only the spreadsheet ID.
const SPREADSHEET_ID_OR_URL = "https://docs.google.com/spreadsheets/d/1yRuMyHhmR-TxzwgYkwLxtUviz7-rkYCXa9fxBU4c4Q4/edit?usp=sharing";
const SHEET_NAME = "Coupons";
const HUNDI_SHEET_NAME = "Hundi";
const SYNC_LOG_SHEET_NAME = "Sync Log";

function doGet() {
  const spreadsheet = openTargetSpreadsheet();
  writeSyncLog(spreadsheet, "GET test", 0, 0);

  return jsonResponse({
    ok: true,
    message: "Coupon tracker Apps Script is deployed and can open the spreadsheet.",
    spreadsheetName: spreadsheet.getName()
  });
}

function doPost(e) {
  const payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const hundiRows = Array.isArray(payload.hundiRows) ? payload.hundiRows : [];
  const spreadsheet = openTargetSpreadsheet();

  writeCouponsSheet(spreadsheet, rows);
  writeHundiSheet(spreadsheet, hundiRows);
  writeSyncLog(spreadsheet, payload.updatedAt || new Date().toISOString(), rows.length, hundiRows.length);

  return jsonResponse({
    ok: true,
    updatedAt: payload.updatedAt || "",
    couponRows: rows.length,
    hundiRows: hundiRows.length
  });
}

function writeCouponsSheet(spreadsheet, rows) {
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  const headers = [
    "Coupon",
    "Assigned To",
    "Assigned Date",
    "Devotee Contact",
    "Buyer Name",
    "Buyer Contact",
    "Amount",
    "Receipt No",
    "Payment Mode",
    "Settlement",
    "Settled Date",
    "Description"
  ];
  const values = rows.map((row) => [
    row.coupon || "",
    row.assignedTo || "",
    row.assignedDate || "",
    row.devoteeContact || "",
    row.buyerName || "",
    row.buyerContact || "",
    row.amount || "",
    row.receiptNumber || "",
    row.paymentMode || "",
    row.settlement || "",
    row.settledDate || "",
    row.description || ""
  ]);

  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (values.length) {
    sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  }
}

function writeHundiSheet(spreadsheet, rows) {
  const sheet = spreadsheet.getSheetByName(HUNDI_SHEET_NAME) || spreadsheet.insertSheet(HUNDI_SHEET_NAME);
  const headers = ["Date", "Devotee", "Devotee Contact", "Amount", "Settlement"];
  const values = rows.map((row) => [
    row.date || "",
    row.devoteeName || "",
    row.devoteeContact || "",
    row.amount || "",
    row.settlement || ""
  ]);

  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (values.length) {
    sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  }
}

function openTargetSpreadsheet() {
  const id = extractSpreadsheetId(SPREADSHEET_ID_OR_URL);
  const spreadsheet = id
    ? SpreadsheetApp.openById(id)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error("No spreadsheet found. Paste the Google Sheet URL/ID into SPREADSHEET_ID_OR_URL.");
  }

  return spreadsheet;
}

function extractSpreadsheetId(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : text;
}

function writeSyncLog(spreadsheet, updatedAt, couponRowCount, hundiRowCount) {
  const logSheet = spreadsheet.getSheetByName(SYNC_LOG_SHEET_NAME) || spreadsheet.insertSheet(SYNC_LOG_SHEET_NAME);
  logSheet.getRange(1, 1, 1, 4).setValues([["Last Sync", "Coupon Rows", "Hundi Rows", "Server Time"]]);
  logSheet.getRange(2, 1, 1, 4).setValues([[updatedAt, couponRowCount, hundiRowCount, new Date()]]);
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
