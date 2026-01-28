function doGet(e) {
    const sheet = getSheet();
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
            barcode: String(row[4] || "")
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

        const sheet = getSheet();

        // Clear existing data
        sheet.clearContents();

        // Set Header
        const headers = ["ID", "商品名", "単価", "在庫数", "バーコード"];

        if (!Array.isArray(payload) || payload.length === 0) {
            sheet.appendRow(headers);
            return createResponse({ status: "success", message: "Cleared all data" });
        }

        // Prepare Data
        const rows = [headers];
        payload.forEach(p => {
            rows.push([
                p.id,
                p.name,
                p.price,
                p.stock,
                p.barcode || ""
            ]);
        });

        // Bulk write
        sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);

        return createResponse({ status: "success", count: payload.length });

    } catch (error) {
        return createResponse({ status: "error", message: error.toString() });
    }
}

function getSheet() {
    return SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
}

function createResponse(data) {
    return ContentService.createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
}

function test() {
    Logger.log(doGet());
}
