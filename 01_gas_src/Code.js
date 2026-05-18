function doGet(e) {
    const sheet = getProductSheet();
    const data = sheet.getDataRange().getValues();

    if (data.length <= 1) {
        return createResponse([]);
    }

    // Header: ID, Name, Price, Stock, Barcode
    const headers = data[0];
    const products = [];

    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        products.push({
            id: Number(row[0]),
            name: String(row[1]),
            price: Number(row[2]),
            stock: Number(row[3]),
            barcode: String(row[4] || ""),
            category: String(row[5] || "")
        });
    }

    return createResponse(products);
}

function doPost(e) {
    try {
        let payload;

        // Support both JSON payload and Form parameter 'data'
        if (e.parameter && e.parameter.data) {
            payload = JSON.parse(e.parameter.data);
        } else if (e.postData && e.postData.contents) {
            payload = JSON.parse(e.postData.contents);
        } else {
            throw new Error("No data found");
        }

        const sheet = getProductSheet();

        // Clear existing data
        sheet.clearContents();

        // Set Header
        const headers = ["ID", "商品名", "単価", "在庫数", "バーコード", "カテゴリ"];

        // Extract products array from payload (support both formats)
        let productList;
        if (Array.isArray(payload)) {
            // Legacy format: payload is directly an array
            productList = payload;
        } else if (payload.products && Array.isArray(payload.products)) {
            // New format: { products: [...], logs: [...] }
            productList = payload.products;
        } else {
            productList = [];
        }

        if (productList.length === 0) {
            sheet.appendRow(headers);
            const logCount = appendLogs(payload.logs);
            return createResponse({ status: "success", count: 0, logCount: logCount, message: "Cleared all data" });
        }

        // Prepare Data
        const rows = [headers];
        productList.forEach(p => {
            rows.push([
                p.id,
                p.name,
                p.price,
                p.stock,
                p.barcode || "",
                p.category || ""
            ]);
        });

        // Bulk write
        sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
        const logCount = appendLogs(payload.logs);

        return createResponse({ status: "success", count: productList.length, logCount: logCount });

    } catch (error) {
        return createResponse({ status: "error", message: error.toString() });
    }
}

function appendLogs(logs) {
    if (!Array.isArray(logs) || logs.length === 0) return 0;

    const sheet = getLogSheet();
    const headers = ["日時", "商品ID", "商品名", "増減", "結果在庫", "バーコード"];
    if (sheet.getLastRow() === 0) {
        sheet.appendRow(headers);
    }

    const rows = logs.map(log => [
        log.timestamp || "",
        log.productId !== undefined && log.productId !== null ? log.productId : "",
        log.name || "",
        log.delta || "",
        log.resultStock !== undefined && log.resultStock !== null ? log.resultStock : "",
        log.barcode || ""
    ]);
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
    return rows.length;
}

function getProductSheet() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    return ss.getSheetByName("商品") ||
        ss.getSheets().find(sheet => sheet.getName() !== "ログ") ||
        ss.getActiveSheet();
}

function getLogSheet() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = "ログ";
    return ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
}

function createResponse(data) {
    return ContentService.createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
}

function test() {
    Logger.log(doGet());
}
