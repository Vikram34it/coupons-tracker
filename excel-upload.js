// ============================================================
// 📤 EXCEL UPLOAD FEATURE  (excel-upload.js)
// Depends on: SheetJS (XLSX global), app.js globals
// ============================================================

const VALID_SEVAS = [
  "Deepa Seva", "Chenetha Seva", "Sumangala Subhadram",
  "Panchopachara Seva", "General Donation", "Prasadam Donation", "Donation in Kind"
];

/**
 * Renders the Upload Excel UI panel inside the entryList container.
 */
function renderExcelUploadTab() {
  const devoteeId = els.entryDevotee.value;
  const devotee = state.devotees.find(d => d.id === devoteeId);
  const assigned = devoteeId ? couponsForDevotee(devoteeId) : [];

  els.entryList.innerHTML = `
    <div class="panel excel-upload-panel">
      <h3>📤 Upload Coupon Data from Excel</h3>
      <p class="hint" style="margin-bottom:16px">
        Upload an Excel file (.xlsx or .xls) to fill in buyer details for your assigned coupons in bulk.
        Download the template first — it already has your assigned coupon numbers pre-filled.
      </p>

      <div class="excel-step-row">
        <div class="excel-step">
          <div class="excel-step-num">1</div>
          <div>
            <strong>Download Template</strong>
            <p class="hint" style="margin-top:4px">
              Pre-filled with ${assigned.length > 0 ? `your ${assigned.length} assigned coupon numbers` : 'assigned coupon numbers'}.
            </p>
            <button type="button" id="downloadExcelTemplateBtn" class="ghost" style="margin-top:8px">
              ⬇️ Download Template
            </button>
          </div>
        </div>

        <div class="excel-step">
          <div class="excel-step-num">2</div>
          <div>
            <strong>Fill in the Excel</strong>
            <p class="hint" style="margin-top:4px">
              Fill columns: Buyer Name, Contact, Amount, Seva Type, Receipt No, Payment Mode.
              Leave any column blank to keep the existing value.
            </p>
          </div>
        </div>

        <div class="excel-step">
          <div class="excel-step-num">3</div>
          <div>
            <strong>Upload &amp; Import</strong>
            <p class="hint" style="margin-top:4px">Select your filled Excel file to preview and import.</p>
            <label class="ghost file-label" style="margin-top:8px;display:inline-flex;align-items:center;gap:6px;cursor:pointer">
              📂 Choose File (.xlsx / .xls)
              <input type="file" id="excelUploadInput" accept=".xlsx,.xls" style="display:none">
            </label>
          </div>
        </div>
      </div>

      <div class="excel-format-box">
        <strong>Required Column Names (case-insensitive, order doesn't matter):</strong>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
          <span class="coupon-pill">Coupon Number</span>
          <span class="coupon-pill">Buyer Name</span>
          <span class="coupon-pill">Contact</span>
          <span class="coupon-pill">Amount</span>
          <span class="coupon-pill">Seva Type</span>
          <span class="coupon-pill">Receipt No</span>
          <span class="coupon-pill">Payment Mode</span>
        </div>
        <p class="hint" style="margin-top:10px;line-height:1.6">
          <strong>Seva Type options:</strong> ${VALID_SEVAS.join(" &nbsp;|&nbsp; ")}<br>
          <strong>Payment Mode options:</strong> Cash &nbsp;|&nbsp; Temple Transfer
        </p>
      </div>

      <div id="excelPreview" style="margin-top:16px"></div>
    </div>
  `;

  document.getElementById("downloadExcelTemplateBtn").addEventListener("click", () => {
    downloadExcelTemplate(devoteeId);
  });

  document.getElementById("excelUploadInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) importFromExcel(file, devoteeId);
    e.target.value = ""; // allow re-selecting same file
  });
}

/**
 * Generates and downloads an Excel template pre-filled with assigned coupon numbers.
 */
function downloadExcelTemplate(devoteeId) {
  if (typeof XLSX === "undefined") {
    showToast("Excel library not loaded. Please check your internet connection.");
    return;
  }

  const assigned = devoteeId ? couponsForDevotee(devoteeId) : [];
  if (!assigned.length) {
    showToast("No coupons are assigned to this devotee.");
    return;
  }

  const devotee = state.devotees.find(d => d.id === devoteeId);
  const devName = devotee ? devotee.name : "Devotee";

  const headers = [
    "Coupon Number", "Buyer Name", "Contact", "Amount",
    "Seva Type", "Receipt No", "Payment Mode"
  ];

  const rows = assigned.map(c => [
    c.number,
    c.buyerName || "",
    c.buyerContact || "",
    c.amount || "",
    c.description || "",
    c.receiptNumber || "",
    c.paymentMode === "temple_transfer" ? "Temple Transfer" : "Cash"
  ]);

  const wsData = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Column widths
  ws["!cols"] = [
    { wch: 16 }, { wch: 24 }, { wch: 16 }, { wch: 12 },
    { wch: 26 }, { wch: 14 }, { wch: 18 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Coupons");

  const filename = `coupon-template-${devName.replace(/\s+/g, "_")}.xlsx`;
  XLSX.writeFile(wb, filename);
  showToast("Template downloaded: " + filename);
}

/**
 * Normalizes a column header key for flexible fuzzy matching.
 */
function _normalizeKey(str) {
  return String(str).toLowerCase().replace(/[\s_\-\.\/]+/g, "");
}

const _EXCEL_FIELD_MAP = {
  "couponnumber":  "number",
  "coupon":        "number",
  "couponno":      "number",
  "no":            "number",

  "buyername":     "buyerName",
  "name":          "buyerName",
  "buyer":         "buyerName",

  "contact":       "buyerContact",
  "phone":         "buyerContact",
  "mobile":        "buyerContact",
  "contactnumber": "buyerContact",

  "amount":        "amount",
  "amountreceived":"amount",
  "price":         "amount",

  "sevatype":      "description",
  "seva":          "description",
  "description":   "description",
  "type":          "description",

  "receiptno":     "receiptNumber",
  "receiptnumber": "receiptNumber",
  "receipt":       "receiptNumber",

  "paymentmode":   "paymentMode",
  "payment":       "paymentMode",
  "mode":          "paymentMode",
  "paymode":       "paymentMode"
};

/**
 * Parses the uploaded Excel file, validates rows, shows a preview table,
 * and on confirm merges the data into state.
 */
function importFromExcel(file, devoteeId) {
  if (typeof XLSX === "undefined") {
    showToast("Excel library not loaded. Please check your internet connection.");
    return;
  }

  if (!devoteeId) {
    showToast("Select a devotee first.");
    return;
  }

  const reader = new FileReader();

  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });

      if (!workbook.SheetNames.length) {
        showToast("No sheets found in the Excel file.");
        return;
      }

      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      if (!rawRows.length) {
        showToast("The Excel file is empty.");
        return;
      }

      // Map each raw row to normalized field names
      const parsed = rawRows.map((row, rowIdx) => {
        const mapped = { _rowIdx: rowIdx + 2 }; // +2 = 1-based + header row
        Object.entries(row).forEach(([key, val]) => {
          const nk = _normalizeKey(key);
          const field = _EXCEL_FIELD_MAP[nk];
          if (field && mapped[field] === undefined) {
            mapped[field] = String(val).trim();
          }
        });
        return mapped;
      });

      // Guard: make sure Coupon Number column was mapped
      const hasNumCol = parsed.some(r => r.number !== undefined && r.number !== "");
      if (!hasNumCol) {
        const previewEl = document.getElementById("excelPreview");
        if (previewEl) {
          previewEl.innerHTML = `
            <div class="excel-errors">
              <strong>❌ Could not find a "Coupon Number" column in your file.</strong><br>
              Please use the downloaded template — it already has the correct column headers.
            </div>`;
        }
        return;
      }

      const assignedNums = new Set(couponsForDevotee(devoteeId).map(c => c.number));
      const errors = [];
      const valid = [];

      parsed.forEach((row) => {
        const num = parseInt(row.number, 10);

        if (!num || isNaN(num)) {
          if (String(row.number).trim()) {
            errors.push(`Row ${row._rowIdx}: Invalid Coupon Number "${row.number}" — skipped.`);
          }
          // silently skip rows with completely blank coupon number
          return;
        }

        if (!assignedNums.has(num)) {
          errors.push(`Row ${row._rowIdx}: Coupon #${num} is not assigned to this devotee — skipped.`);
          return;
        }

        // Payment mode
        let paymentMode = "cash";
        if (row.paymentMode) {
          const pm = row.paymentMode.toLowerCase();
          if (pm.includes("temple") || pm.includes("transfer")) paymentMode = "temple_transfer";
        }

        // Seva type — case-insensitive match to valid list
        let description = row.description || "";
        if (description) {
          const found = VALID_SEVAS.find(s => s.toLowerCase() === description.toLowerCase());
          description = found || description; // keep original if no match
        }

        // Amount — must be numeric if provided
        let amount = String(row.amount || "").trim();
        if (amount && isNaN(Number(amount))) {
          errors.push(`Row ${row._rowIdx}: Coupon #${num} — Amount "${amount}" is not a valid number — skipped.`);
          return;
        }

        valid.push({
          number: num,
          buyerName: row.buyerName || "",
          buyerContact: row.buyerContact || "",
          amount: amount ? String(Number(amount)) : "",
          description,
          receiptNumber: row.receiptNumber || "",
          paymentMode
        });
      });

      const previewEl = document.getElementById("excelPreview");
      if (!previewEl) return;

      const errorHtml = errors.length
        ? `<div class="excel-errors">
            <strong>⚠️ ${errors.length} row(s) will be skipped:</strong>
            <ul style="margin:6px 0 0 18px;padding:0">${errors.map(err => `<li>${escapeHtml(err)}</li>`).join("")}</ul>
           </div>`
        : "";

      if (!valid.length) {
        previewEl.innerHTML = `${errorHtml}<div class="empty" style="margin-top:12px">No valid rows to import.</div>`;
        return;
      }

      const previewRows = valid.map(r => `
        <tr>
          <td>#${r.number}</td>
          <td>${escapeHtml(r.buyerName || "–")}</td>
          <td>${escapeHtml(r.buyerContact || "–")}</td>
          <td>${r.amount ? formatMoney(Number(r.amount)) : "–"}</td>
          <td>${escapeHtml(r.description || "–")}</td>
          <td>${escapeHtml(r.receiptNumber || "–")}</td>
          <td>${r.paymentMode === "temple_transfer" ? "Temple Transfer" : "Cash"}</td>
        </tr>`).join("");

      previewEl.innerHTML = `
        ${errorHtml}
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
          <strong style="font-size:15px">✅ ${valid.length} coupon(s) ready to import — please review:</strong>
          <div style="display:flex;gap:8px">
            <button type="button" id="confirmExcelImportBtn" class="primary">
              ✅ Confirm Import (${valid.length} rows)
            </button>
            <button type="button" id="cancelExcelImportBtn" class="ghost">Cancel</button>
          </div>
        </div>
        <div class="table-wrap" style="max-height:400px">
          <table>
            <thead>
              <tr>
                <th>Coupon</th><th>Buyer Name</th><th>Contact</th>
                <th>Amount</th><th>Seva Type</th><th>Receipt No</th><th>Payment Mode</th>
              </tr>
            </thead>
            <tbody>${previewRows}</tbody>
          </table>
        </div>
      `;

      document.getElementById("confirmExcelImportBtn").addEventListener("click", () => {
        let updated = 0;
        valid.forEach(row => {
          const coupon = state.coupons[row.number - 1];
          if (!coupon) return;
          // Only overwrite non-empty values from Excel
          if (row.buyerName)     coupon.buyerName     = row.buyerName;
          if (row.buyerContact)  coupon.buyerContact  = row.buyerContact;
          if (row.amount)        coupon.amount        = row.amount;
          if (row.description)   coupon.description   = row.description;
          if (row.receiptNumber) coupon.receiptNumber = row.receiptNumber;
          coupon.paymentMode = row.paymentMode; // always set (has a default)
          coupon._updated = ts();
          updated++;
        });

        saveState();
        showToast("✅ " + updated + " coupon(s) imported from Excel");

        // Switch to Sold tab to review imported data
        activeDevoteeTab = "sold";
        document.querySelectorAll("[data-devotee-tab]").forEach(t => t.classList.remove("active"));
        const soldTab = document.querySelector("[data-devotee-tab='sold']");
        if (soldTab) soldTab.classList.add("active");
        renderEntryList();
        renderStats();
        renderDevotees();
      });

      document.getElementById("cancelExcelImportBtn").addEventListener("click", () => {
        previewEl.innerHTML = "";
      });

    } catch (err) {
      console.error("Excel parse error:", err);
      showToast("Failed to read Excel file. Please use a valid .xlsx or .xls file.");
    }
  };

  reader.onerror = () => showToast("Failed to read the file.");
  reader.readAsArrayBuffer(file);
}
