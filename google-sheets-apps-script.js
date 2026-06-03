// Paste this into Google Apps Script, update SHEET_NAME if needed,
// deploy as a Web App, then paste the Web App URL into the tracker setup.
const SHEET_NAME = "Coupons";

function doPost(e) {
  const payload = JSON.parse(e.postData.contents || "{}");
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
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

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, updatedAt: payload.updatedAt || "" }))
    .setMimeType(ContentService.MimeType.JSON);
}
