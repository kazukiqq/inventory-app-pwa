// App Logic

// Data State
let products = [];
let categories = [];
let html5QrcodeScanner = null;
let scannerStopPromise = null;
const APP_VERSION = '1.2.41';
const SCAN_CONFIRM_REQUIRED = 3;
const SCAN_CONFIRM_MAX_GAP_MS = 1500;
const GTIN_SCANNER_FORMAT_NAMES = new Set(['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E']);
const FLEXIBLE_SCANNER_FORMAT_NAMES = new Set(['CODE_128', 'CODE_39', 'ITF', 'CODABAR']);
const SUPPORTED_SCANNER_FORMAT_NAMES = new Set([
    ...GTIN_SCANNER_FORMAT_NAMES,
    ...FLEXIBLE_SCANNER_FORMAT_NAMES
]);
const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbyEN-GRJaa9qKRnFsryZ9Gcd__cZlc1E9h884sKRZc_f_9HaXilz1YijY0C0ln0J0zwPQ/exec';


// Initial Load
document.addEventListener('DOMContentLoaded', () => {
    // 起動確認用アラート（一度更新されれば確認できるはずです）
    console.log(`App version: v${APP_VERSION}`);

    loadData();
    loadCategories();
    // Default tab
    navigateToView('view-search');
    setupNavigation();
    setupForms();
    renderInventory();
    renderMasterList();
    renderCategoryList();
    renderCategoryDropdowns();

    // Scan buttons
    const scanBtn = document.getElementById('scan-btn');
    if (scanBtn) scanBtn.onclick = () => startScanner('search-input');

    const masterScanBtn = document.getElementById('master-scan-btn');
    if (masterScanBtn) {
        console.log('Setup: Master scan button found');
        masterScanBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Click: Master scan button clicked');
            startScanner('prod-barcode');
        });
    } else {
        console.error('Setup: Master scan button NOT found');
    }

    // Close scanner button
    const closeBtn = document.getElementById('close-scanner-btn');
    if (closeBtn) closeBtn.onclick = () => stopScanner();

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        let refreshing = false;

        // Listen for the controlling service worker changing
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            refreshing = true;
            window.location.reload();
        });

        window.addEventListener('load', () => {
            // App version to bypass HTTP cache for sw.js itself
            const swUrl = `./sw.js?build=${APP_VERSION}`;
            navigator.serviceWorker.register(swUrl, { updateViaCache: 'none' })
                .then(reg => {
                    console.log(`SW Registered: v${APP_VERSION}`);

                    // Periodically check for updates
                    reg.update();

                    reg.onupdatefound = () => {
                        const installingWorker = reg.installing;
                        installingWorker.onstatechange = () => {
                            if (installingWorker.state === 'installed') {
                                if (navigator.serviceWorker.controller) {
                                    // New content is available; ask user to reload
                                    console.log('New content available, prompting user...');
                                    if (confirm('新しいバージョンが利用可能です。更新しますか？')) {
                                        if (installingWorker) {
                                            installingWorker.postMessage({ type: 'SKIP_WAITING' });
                                        }
                                    }
                                }
                            }
                        };
                    };
                })
                .catch(err => console.error('Service Worker registration failed', err));
        });
    }
});

// --- Utilities ---
function normalizeString(val) {
    if (val === null || val === undefined) return '';
    // Use NFKC to normalize full-width/half-width characters (e.g., Ａ->A, １->1, ｱ->ア)
    return String(val).normalize('NFKC').trim();
}

function normalizeBarcode(val) {
    return normalizeString(val).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

function barcodeMatches(productBarcode, queryBarcode) {
    const productCode = normalizeBarcode(productBarcode);
    const queryCode = normalizeBarcode(queryBarcode);
    if (!productCode || !queryCode) return false;
    if (productCode === queryCode) return true;

    // UPC-A may be reported as EAN-13 with a leading zero depending on the
    // browser decoder. Compare valid GTINs in their canonical 14-digit form.
    if (canonicalizeGtin(productCode) === canonicalizeGtin(queryCode)) return true;

    // Manual short searches can still narrow by barcode prefix/part.
    // Full barcode reads must be exact so search and registration stay identical.
    return queryCode.length < 8 && productCode.includes(queryCode);
}

function barcodeEquivalent(leftBarcode, rightBarcode) {
    const leftCode = normalizeBarcode(leftBarcode);
    const rightCode = normalizeBarcode(rightBarcode);
    if (!leftCode || !rightCode) return false;
    return leftCode === rightCode || canonicalizeGtin(leftCode) === canonicalizeGtin(rightCode);
}

function isFullBarcodeQuery(query) {
    return /^\d{8,}$/.test(normalizeBarcode(query));
}

function normalizeScannedCode(val) {
    return normalizeBarcode(val) || normalizeString(val);
}

function isGtinLength(code) {
    return [8, 12, 13, 14].includes(code.length);
}

function hasValidGtinCheckDigit(code) {
    if (!/^\d+$/.test(code) || !isGtinLength(code)) return false;

    const digits = code.split('').map(Number);
    const checkDigit = digits.pop();
    let sum = 0;
    let weight = 3;

    for (let i = digits.length - 1; i >= 0; i--) {
        sum += digits[i] * weight;
        weight = weight === 3 ? 1 : 3;
    }

    return (10 - (sum % 10)) % 10 === checkDigit;
}

function canonicalizeGtin(code) {
    const normalizedCode = normalizeBarcode(code);
    if (hasValidGtinCheckDigit(normalizedCode)) return normalizedCode.padStart(14, '0');

    const expandedUpca = expandUpceToUpca(normalizedCode);
    if (expandedUpca && hasValidGtinCheckDigit(expandedUpca)) return expandedUpca.padStart(14, '0');

    return normalizedCode;
}

function getDecodedFormatName(decodedResult) {
    return normalizeString(decodedResult?.result?.format?.formatName).toUpperCase();
}

function expandUpceToUpca(code) {
    const normalizedCode = normalizeBarcode(code);
    if (!/^[01]\d{7}$/.test(normalizedCode)) return '';

    const numberSystem = normalizedCode[0];
    const data = normalizedCode.slice(1, 7);
    const checkDigit = normalizedCode[7];
    const lastDataDigit = data[5];
    let expandedBody = '';

    if (['0', '1', '2'].includes(lastDataDigit)) {
        expandedBody = `${data.slice(0, 2)}${lastDataDigit}0000${data.slice(2, 5)}`;
    } else if (lastDataDigit === '3') {
        expandedBody = `${data.slice(0, 3)}00000${data.slice(3, 5)}`;
    } else if (lastDataDigit === '4') {
        expandedBody = `${data.slice(0, 4)}00000${data[4]}`;
    } else {
        expandedBody = `${data.slice(0, 5)}0000${lastDataDigit}`;
    }

    return `${numberSystem}${expandedBody}${checkDigit}`;
}

function hasValidScannedCheckDigit(code, formatName) {
    if (formatName === 'UPC_E') {
        const expandedUpca = expandUpceToUpca(code);
        return Boolean(expandedUpca && hasValidGtinCheckDigit(expandedUpca));
    }

    if (hasValidGtinCheckDigit(code)) return true;

    // Some native decoders omit format metadata. For an 8-digit candidate,
    // also try the UPC-E expansion before rejecting it.
    if (!formatName && code.length === 8) {
        const expandedUpca = expandUpceToUpca(code);
        return Boolean(expandedUpca && hasValidGtinCheckDigit(expandedUpca));
    }

    return false;
}

function isValidScannedBarcodeCandidate(code, decodedResult) {
    if (!code) return false;

    const formatName = getDecodedFormatName(decodedResult);
    if (formatName && !SUPPORTED_SCANNER_FORMAT_NAMES.has(formatName)) return false;

    if (!formatName || GTIN_SCANNER_FORMAT_NAMES.has(formatName)) {
        const validGtin = /^\d+$/.test(code)
            && [8, 12, 13].includes(code.length)
            && hasValidScannedCheckDigit(code, formatName);
        if (validGtin || formatName) return validGtin;
    }

    // CODE-128, CODE-39, ITF and Codabar are frequently used for internal
    // inventory labels and do not always carry a GTIN check digit.
    if (!/^[0-9A-Z]{4,64}$/.test(code)) return false;
    if (formatName === 'ITF' && (!/^\d+$/.test(code) || code.length % 2 !== 0)) return false;

    return true;
}

function getSupportedScannerFormats() {
    return [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.CODABAR
    ];
}

function getScannerQrbox(viewfinderWidth, viewfinderHeight) {
    const padding = 16;
    const maxWidth = Math.max(260, viewfinderWidth - padding);
    const maxHeight = Math.max(220, viewfinderHeight - padding);
    const width = Math.floor(Math.min(maxWidth, viewfinderWidth * 0.96));
    const height = Math.floor(Math.min(maxHeight, viewfinderHeight * 0.84));
    return { width, height };
}

function getScannerAspectRatio() {
    return window.innerWidth > window.innerHeight ? 16 / 9 : 3 / 4;
}

function getScannerCameraConfig() {
    return { facingMode: "environment" };
}

async function widenScannerCameraView(html5QrCode) {
    try {
        const capabilities = html5QrCode.getRunningTrackCameraCapabilities?.();
        const zoom = capabilities && capabilities.zoom;

        if (!zoom || typeof zoom.min !== 'number') {
            return;
        }

        await html5QrCode.applyVideoConstraints({
            advanced: [{ zoom: zoom.min }]
        });
    } catch (err) {
        console.warn("Could not widen camera view", err);
    }
}

async function optimizeScannerCamera(html5QrCode) {
    await widenScannerCameraView(html5QrCode);

    const track = getScannerVideoTrack();
    if (!track || typeof track.getCapabilities !== 'function' || typeof track.applyConstraints !== 'function') {
        return;
    }

    try {
        const capabilities = track.getCapabilities();
        const continuousModes = {};

        ['focusMode', 'exposureMode', 'whiteBalanceMode'].forEach((name) => {
            if (Array.isArray(capabilities[name]) && capabilities[name].includes('continuous')) {
                continuousModes[name] = 'continuous';
            }
        });

        if (Object.keys(continuousModes).length > 0) {
            await track.applyConstraints({ advanced: [continuousModes] });
        }
    } catch (err) {
        console.warn("Could not optimize camera focus", err);
    }
}

function getScannerVideoTrack() {
    const video = document.querySelector('#reader video');
    const stream = video && video.srcObject;
    if (!stream || typeof stream.getVideoTracks !== 'function') return null;

    return stream.getVideoTracks().find(track => track.readyState === 'live') || null;
}

function getTorchSupport(track) {
    if (!track || typeof track.getCapabilities !== 'function') {
        return { supported: false, capabilities: null };
    }

    try {
        const capabilities = track.getCapabilities();
        return {
            supported: capabilities.torch === true,
            capabilities
        };
    } catch (err) {
        console.warn("Could not get torch capabilities", err);
        return { supported: false, capabilities: null };
    }
}

async function applyScannerTorch(html5QrCode, track, shouldTurnOn) {
    const attempts = [];

    if (track && typeof track.applyConstraints === 'function') {
        attempts.push(() => track.applyConstraints({ advanced: [{ torch: shouldTurnOn }] }));
        attempts.push(() => track.applyConstraints({ torch: shouldTurnOn }));
    }

    if (html5QrCode && typeof html5QrCode.applyVideoConstraints === 'function') {
        attempts.push(() => html5QrCode.applyVideoConstraints({ advanced: [{ torch: shouldTurnOn }] }));
        attempts.push(() => html5QrCode.applyVideoConstraints({ torch: shouldTurnOn }));
    }

    let lastError = null;
    for (const attempt of attempts) {
        try {
            await attempt();
            const settings = typeof track?.getSettings === 'function' ? track.getSettings() : {};
            if (typeof settings.torch === 'boolean' && settings.torch !== shouldTurnOn) {
                throw new Error('Torch setting did not change on the active camera track.');
            }
            return;
        } catch (err) {
            lastError = err;
        }
    }

    throw lastError || new Error('Torch control is not available on this camera.');
}

function setupScannerTorchControl(html5QrCode, retryCount = 0) {
    const torchBtn = document.getElementById('scanner-torch-btn');
    if (!torchBtn) return;

    const track = getScannerVideoTrack();
    if (!track && retryCount < 5) {
        setTimeout(() => setupScannerTorchControl(html5QrCode, retryCount + 1), 300);
        return;
    }

    const { supported, capabilities } = getTorchSupport(track);
    console.log('Camera torch capabilities:', capabilities);

    torchBtn.style.display = 'block';
    torchBtn.onclick = null;

    if (!track || !supported) {
        torchBtn.disabled = true;
        torchBtn.textContent = 'ライト非対応';
        setScannerStatus('この端末またはブラウザではライト操作に対応していません。', 'warn');
        return;
    }

    let isTorchOn = false;
    torchBtn.disabled = false;
    torchBtn.textContent = 'ライト ON';

    torchBtn.onclick = async () => {
        const nextTorchState = !isTorchOn;
        torchBtn.disabled = true;
        torchBtn.textContent = nextTorchState ? 'ライト切替中...' : 'ライトOFF中...';

        try {
            await applyScannerTorch(html5QrCode, track, nextTorchState);
            isTorchOn = nextTorchState;
            torchBtn.textContent = isTorchOn ? 'ライト OFF' : 'ライト ON';
            setScannerStatus(isTorchOn ? 'ライトをオンにしました。' : 'ライトをオフにしました。', 'success');
        } catch (err) {
            console.warn("Could not toggle torch", err);
            torchBtn.textContent = isTorchOn ? 'ライト OFF' : 'ライト ON';
            setScannerStatus('ライトを切り替えられませんでした。この端末では非対応の可能性があります。', 'warn');
        } finally {
            if (track.readyState === 'live') {
                torchBtn.disabled = false;
            }
        }
    };
}

function normalizeText(val) {
    if (val === null || val === undefined) return '';
    return String(val).trim();
}

function escapeHtml(val) {
    return String(val ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function parseNumberInput(val, fallback = 0) {
    const normalized = normalizeString(val).replace(/,/g, '');
    if (!normalized) return fallback;
    const num = Number(normalized);
    return Number.isFinite(num) ? num : fallback;
}

function normalizeProduct(raw, fallbackId = Date.now()) {
    const idValue = Number(raw && raw.id);
    return {
        id: Number.isFinite(idValue) ? idValue : fallbackId,
        name: normalizeText(raw && raw.name),
        price: Math.max(0, Math.trunc(parseNumberInput(raw && raw.price))),
        stock: Math.max(0, Math.trunc(parseNumberInput(raw && raw.stock))),
        barcode: normalizeBarcode(raw && raw.barcode),
        category: normalizeText(raw && raw.category)
    };
}

function readJsonArray(key, label) {
    const data = localStorage.getItem(key);
    if (!data) return null;

    try {
        const parsed = JSON.parse(data);
        if (!Array.isArray(parsed)) throw new Error('Saved value is not an array');
        return parsed;
    } catch (error) {
        console.error(`${label} parse failed`, error);
        alert(`${label}の保存データを読み込めませんでした。データを上書きせず、空の状態で起動します。`);
        return [];
    }
}

function saveJson(key, value, label) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        console.error(`${label} save failed`, error);
        alert(`${label}の保存に失敗しました。端末の空き容量またはブラウザの保存容量を確認してください。`);
        return false;
    }
}

function saveTextSetting(key, value, label) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (error) {
        console.error(`${label} save failed`, error);
        alert(`${label}の保存に失敗しました。端末の保存容量を確認してください。`);
        return false;
    }
}

function normalizeCategoriesFromProducts(productList) {
    const seen = new Set();
    const result = [];

    productList.forEach(product => {
        const category = normalizeText(product && product.category);
        if (!category || seen.has(category)) return;
        seen.add(category);
        result.push(category);
    });

    return result;
}

function mergeCategories(primaryCategories, productList) {
    const seen = new Set();
    const result = [];

    [...primaryCategories, ...normalizeCategoriesFromProducts(productList)].forEach(category => {
        const normalized = normalizeText(category);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        result.push(normalized);
    });

    return result;
}

function getSavedGasUrl() {
    return localStorage.getItem('inventory_app_gas_url') || DEFAULT_GAS_URL;
}

function getCurrentGasUrl() {
    const gasUrlInput = document.getElementById('gas-app-url');
    const currentValue = gasUrlInput ? normalizeText(gasUrlInput.value) : '';
    const url = currentValue || getSavedGasUrl();

    if (gasUrlInput && gasUrlInput.value !== url) {
        gasUrlInput.value = url;
    }
    saveTextSetting('inventory_app_gas_url', url, 'GAS URL');
    return url;
}

function getStockLogs() {
    return readJsonArray('inventory_app_logs', '在庫履歴') || [];
}

function saveStockLogs(logs) {
    return saveJson('inventory_app_logs', logs, '在庫履歴');
}

function csvEscape(val) {
    const str = String(val ?? '');
    if (/[",\r\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function parseCSVRows(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    const src = String(text || '').replace(/^\uFEFF/, '');

    for (let i = 0; i < src.length; i++) {
        const char = src[i];
        const next = src[i + 1];

        if (char === '"') {
            if (inQuotes && next === '"') {
                cell += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === ',' && !inQuotes) {
            row.push(cell);
            cell = '';
            continue;
        }

        if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && next === '\n') i++;
            row.push(cell);
            if (row.some(value => value.trim() !== '')) rows.push(row);
            row = [];
            cell = '';
            continue;
        }

        cell += char;
    }

    row.push(cell);
    if (row.some(value => value.trim() !== '')) rows.push(row);
    return rows;
}

// --- Data Management ---
function loadData() {
    const data = readJsonArray('inventory_app_products', '商品データ');
    if (data) {
        products = data.map((p, index) => normalizeProduct(p, Date.now() + index)).filter(p => p.name);
    } else {
        // Initial Dummy Data
        products = [
            { id: Date.now(), name: 'サンプル商品 A', price: 100, stock: 10, barcode: '123456789' },
        ];
        saveData();
    }
}

function saveData() {
    return saveJson('inventory_app_products', products, '商品データ');
}

// --- Category Management ---
function loadCategories() {
    const data = readJsonArray('inventory_app_categories', 'カテゴリデータ');
    if (data) {
        categories = data.map(normalizeText).filter(Boolean);
    } else {
        categories = ['文具', '食品', '事務用品'];
        saveCategories();
    }
}

function saveCategories() {
    return saveJson('inventory_app_categories', categories, 'カテゴリデータ');
}

function addCategory() {
    const input = document.getElementById('new-category-input');
    const name = input.value.trim();
    if (!name) return alert('カテゴリ名を入力してください');
    if (categories.includes(name)) return alert('既に存在するカテゴリです');

    categories.push(name);
    saveCategories();
    renderCategoryList();
    renderCategoryDropdowns();
    input.value = '';
    alert('カテゴリを追加しました');
}

function deleteCategory(index) {
    const name = categories[index];
    if (!confirm(`「${name}」を削除しますか？\n※このカテゴリに設定されている商品は「カテゴリなし」のような状態になります。`)) return;

    categories.splice(index, 1);
    saveCategories();

    let updatedCount = 0;
    products.forEach(p => {
        if (p.category === name) {
            p.category = '';
            updatedCount++;
        }
    });
    if (updatedCount > 0) {
        saveData();
        renderMasterList();
        renderInventory();
    }

    renderCategoryList();
    renderCategoryDropdowns();
}

function editCategory(index) {
    const oldName = categories[index];
    const newName = prompt('新しいカテゴリ名を入力してください:', oldName);

    if (newName === null) return; // Cancelled
    const trimmed = newName.trim();
    if (!trimmed) {
        alert('カテゴリ名を入力してください');
        return;
    }
    if (trimmed !== oldName && categories.includes(trimmed)) {
        alert('そのカテゴリ名は既に存在します');
        return;
    }

    // Update Category Name
    categories[index] = trimmed;
    saveCategories();

    // Update linked products
    let updatedCount = 0;
    products.forEach(p => {
        if (p.category === oldName) {
            p.category = trimmed;
            updatedCount++;
        }
    });

    if (updatedCount > 0) {
        saveData();
        renderMasterList();
        renderInventory();
        // alert(`関連する商品 ${updatedCount}件のカテゴリ名も更新しました`);
    }

    renderCategoryList();
    renderCategoryDropdowns();
}

function moveCategory(index, direction) {
    // direction: -1 (up), 1 (down)
    if (direction === -1 && index > 0) {
        [categories[index], categories[index - 1]] = [categories[index - 1], categories[index]];
    } else if (direction === 1 && index < categories.length - 1) {
        [categories[index], categories[index + 1]] = [categories[index + 1], categories[index]];
    }
    saveCategories();
    renderCategoryList();
    renderCategoryDropdowns();
}

function renderCategoryList() {
    const container = document.getElementById('category-list');
    if (!container) return;

    // Switch check class for styling
    container.className = 'category-manage-list';
    container.innerHTML = '';

    categories.forEach((cat, index) => {
        const div = document.createElement('div');
        div.className = 'category-manage-item';

        // Buttons state
        const isFirst = index === 0;
        const isLast = index === categories.length - 1;

        div.innerHTML = `
            <span class="category-manage-name">${escapeHtml(cat)}</span>
            <div class="category-controls">
                <button class="btn-small" onclick="moveCategory(${index}, -1)" ${isFirst ? 'disabled style="opacity:0.3"' : ''}>↑</button>
                <button class="btn-small" onclick="moveCategory(${index}, 1)" ${isLast ? 'disabled style="opacity:0.3"' : ''}>↓</button>
                <button class="btn-small" onclick="editCategory(${index})">✎</button>
                <button class="btn-danger-small" onclick="deleteCategory(${index})">🗑️</button>
            </div>
        `;
        container.appendChild(div);
    });
}

function renderCategoryDropdowns() {
    // Product form dropdown
    const prodCategory = document.getElementById('prod-category');
    if (prodCategory) {
        const currentVal = prodCategory.value;
        prodCategory.innerHTML = '<option value="">-- 選択 --</option>';
        categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            prodCategory.appendChild(opt);
        });
        prodCategory.value = currentVal;
    }

    // Inventory filter dropdown
    const inventoryFilter = document.getElementById('inventory-category-filter');
    if (inventoryFilter) {
        const currentVal = inventoryFilter.value;
        inventoryFilter.innerHTML = '<option value="">すべて</option>';
        categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            inventoryFilter.appendChild(opt);
        });
        inventoryFilter.value = currentVal;
    }
}

// --- Navigation ---
function navigateToView(targetId) {
    const navBtns = document.querySelectorAll('.nav-btn');
    const views = document.querySelectorAll('.view');
    const targetBtn = document.querySelector(`.nav-btn[data-target="${targetId}"]`);

    if (!targetBtn) return;

    // Remove active from all
    navBtns.forEach(b => b.classList.remove('active'));
    views.forEach(v => v.classList.remove('active'));

    // Add active to target
    document.getElementById(targetId).classList.add('active');
    targetBtn.classList.add('active');

    // Stop scanner if moving
    stopScanner();

    // Refresh lists
    if (targetId === 'view-inventory') renderInventory();
    if (targetId === 'view-master') renderMasterList();
}

function setupNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    navBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetId = btn.getAttribute('data-target');
            navigateToView(targetId);
        });
    });

    // Swipe Navigation
    const viewIds = ['view-search', 'view-inventory', 'view-master', 'view-settings'];
    let stX = 0;
    let stY = 0;

    document.addEventListener('touchstart', (e) => {
        const target = e.target;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
        if (target.closest('.stock-btn') || target.closest('.nav-btn')) return;

        stX = e.touches[0].screenX;
        stY = e.touches[0].screenY;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
        if (stX === 0) return;

        const enX = e.changedTouches[0].screenX;
        const enY = e.changedTouches[0].screenY;
        const dX = enX - stX;
        const dY = enY - stY;

        stX = 0; // reset

        // Horizontal swipe? (Threshold: 40px)
        if (Math.abs(dX) > 40 && Math.abs(dX) > Math.abs(dY)) {
            const currentView = document.querySelector('.view.active').id;
            const currentIndex = viewIds.indexOf(currentView);
            let targetId = null;

            if (dX < 0 && currentIndex < viewIds.length - 1) {
                // Swipe Left -> Next
                targetId = viewIds[currentIndex + 1];
            } else if (dX > 0 && currentIndex > 0) {
                // Swipe Right -> Prev
                targetId = viewIds[currentIndex - 1];
            }

            if (targetId) {
                if (navigator.vibrate) navigator.vibrate(50); // Haptic feedback
                navigateToView(targetId);
            }
        }
    }, { passive: true });
}

// --- Settings & API ---
function setupForms() {
    const form = document.getElementById('product-form');
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        saveProductFromForm();
    });

    const cancelEditBtn = document.getElementById('cancel-edit');
    if (cancelEditBtn) {
        cancelEditBtn.addEventListener('click', () => resetProductForm());
    }

    // Settings Form
    const settingsForm = document.getElementById('settings-form');
    settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const clientId = document.getElementById('yahoo-client-id').value;
        localStorage.setItem('inventory_app_yahoo_client_id', clientId);
        alert('設定を保存しました');
    });

    // Initialize Settings Input
    const savedClientId = localStorage.getItem('inventory_app_yahoo_client_id');
    if (savedClientId) {
        document.getElementById('yahoo-client-id').value = savedClientId;
    }

    // Search Input Logic
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', (e) => {
        updateSearchInput(e.target.value, false);
    });

    // Inventory Search
    document.getElementById('inventory-search-input').addEventListener('input', (e) => {
        renderInventory(e.target.value);
    });

    // Barcode Input Logic for Master Form
    const barcodeInput = document.getElementById('prod-barcode');
    barcodeInput.addEventListener('change', async (e) => {
        const code = normalizeBarcode(e.target.value);
        e.target.value = code;
        const kokuyoBtn = document.getElementById('kokuyo-search-btn');
        const crownBtn = document.getElementById('crown-search-btn');
        const amazonBtn = document.getElementById('amazon-search-btn');

        if (code) {
            kokuyoBtn.style.display = 'block';
            kokuyoBtn.onclick = () => {
                window.open(`https://www.kokuyo-st.co.jp/search/sp_search.php?flg=1&input_str=${encodeURIComponent(code)}`, '_blank', 'noopener');
            };

            crownBtn.style.display = 'block';
            crownBtn.onclick = () => {
                window.open(`https://www.crowngroup.co.jp/office-zukan/list/?p_keyword=${encodeURIComponent(code)}`, '_blank', 'noopener');
            };

            amazonBtn.style.display = 'block';
            amazonBtn.onclick = () => {
                window.open(`https://www.amazon.co.jp/s?k=${encodeURIComponent(code)}`, '_blank', 'noopener');
            };

            // Auto-fetch if new product
            if (!document.getElementById('prod-id').value) {
                await fetchProductInfo(code);
            }
        } else {
            kokuyoBtn.style.display = 'none';
            crownBtn.style.display = 'none';
            amazonBtn.style.display = 'none';
        }
    });

    // CSV Export
    document.getElementById('download-csv-btn').addEventListener('click', exportCSV);

    // CSV Import
    const fileInput = document.getElementById('csv-file-input');
    document.getElementById('trigger-import-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            importCSV(e.target.files[0]);
            e.target.value = ''; // Reset
        }
    });

    // GAS Settings & Sync
    const gasUrlInput = document.getElementById('gas-app-url');
    gasUrlInput.value = getSavedGasUrl();
    gasUrlInput.addEventListener('input', (e) => {
        saveTextSetting('inventory_app_gas_url', normalizeText(e.target.value), 'GAS URL');
    });
    gasUrlInput.addEventListener('change', (e) => {
        saveTextSetting('inventory_app_gas_url', normalizeText(e.target.value), 'GAS URL');
    });

    document.getElementById('gas-download-btn').addEventListener('click', downloadFromGas);
    document.getElementById('gas-upload-btn').addEventListener('click', uploadToGas);
}

// --- CSV Functions ---
function exportCSV() {
    if (products.length === 0) {
        alert('データがありません');
        return;
    }

    // Header
    const header = ['ID', '商品名', '単価', '在庫数', 'バーコード', 'カテゴリ'].join(',');

    // Rows
    const rows = products.map(p => {
        return [
            p.id,
            csvEscape(p.name),
            p.price,
            p.stock,
            csvEscape(p.barcode),
            csvEscape(p.category)
        ].join(',');
    });

    const csvContent = [header, ...rows].join('\n');

    // BOM for Excel
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, csvContent], { type: 'text/csv' });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory_backup_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function importCSV(file) {
    if (!confirm('現在のデータを上書き（または追加）しますか？\n※同じIDのデータは上書き、新規IDは追加されます。')) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        const rows = parseCSVRows(text);

        // Remove header if it looks like a header
        if (rows.length && rows[0].includes('ID') && rows[0].includes('商品名')) {
            rows.shift();
        }

        let updatedCount = 0;
        let addedCount = 0;
        let skippedCount = 0;

        rows.forEach((cols, index) => {
            // Expected: ID, Name, Price, Stock, Barcode, Category
            const parsedId = parseNumberInput(cols[0], NaN);
            const id = Number.isFinite(parsedId) ? parsedId : Date.now() + index + Math.random();
            const name = normalizeText(cols[1]);
            const price = Math.max(0, Math.trunc(parseNumberInput(cols[2])));
            const stock = Math.max(0, Math.trunc(parseNumberInput(cols[3])));
            const barcode = normalizeBarcode(cols[4] || '');
            const category = normalizeText(cols[5]);

            if (!name) {
                skippedCount++;
                return;
            }

            const existingIndex = products.findIndex(p => p.id === id);

            const newProd = { id, name, price, stock, barcode, category };

            if (existingIndex !== -1) {
                products[existingIndex] = newProd;
                updatedCount++;
            } else {
                products.push(newProd);
                addedCount++;
            }
        });

        if (!saveData()) return;
        renderMasterList();
        renderInventory();
        alert(`読み込み完了:\n更新: ${updatedCount}件\n追加: ${addedCount}件\nスキップ: ${skippedCount}件`);
    };
    reader.readAsText(file);
}

async function fetchProductInfo(janCode) {
    const clientId = localStorage.getItem('inventory_app_yahoo_client_id');
    if (!clientId) return;

    if (janCode.length < 8) return;

    try {
        const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${clientId}&jan_code=${janCode}`;

        const response = await fetch(url);
        if (!response.ok) throw new Error('Network response was not ok');

        const data = await response.json();

        if (data.hits && data.hits.length > 0) {
            const item = data.hits[0];

            document.getElementById('prod-name').value = item.name;
            document.getElementById('prod-price').value = item.price;

            alert('商品情報が見つかりました！');
        }
    } catch (error) {
        console.error('API Error:', error);
    }
}

function saveProductFromForm() {
    const idInput = document.getElementById('prod-id');
    const nameInput = document.getElementById('prod-name');
    const priceInput = document.getElementById('prod-price');
    const stockInput = document.getElementById('prod-stock');
    const barcodeInput = document.getElementById('prod-barcode');
    const categoryInput = document.getElementById('prod-category');
    const name = normalizeText(nameInput.value);
    const isEditing = Boolean(idInput.value);

    if (!name) {
        alert('商品名を入力してください');
        nameInput.focus();
        return;
    }

    const product = {
        id: idInput.value ? parseNumberInput(idInput.value) : Date.now(),
        name: name,
        price: Math.max(0, Math.trunc(parseNumberInput(priceInput.value))),
        stock: Math.max(0, Math.trunc(parseNumberInput(stockInput.value))),
        barcode: normalizeBarcode(barcodeInput.value || ''),
        category: categoryInput ? normalizeText(categoryInput.value) : ''
    };
    const duplicateBarcodeProduct = product.barcode
        ? products.find(p => p.id !== product.id && barcodeEquivalent(p.barcode, product.barcode))
        : null;

    if (duplicateBarcodeProduct) {
        alert(`同じバーコードの商品が既に登録されています。\n登録済み: ${duplicateBarcodeProduct.name}`);
        barcodeInput.focus();
        return;
    }

    if (idInput.value) {
        const index = products.findIndex(p => p.id === product.id);
        if (index !== -1) {
            products[index] = product;
        }
    } else {
        products.push(product);
    }

    if (!saveData()) return;

    resetProductForm();
    alert(isEditing ? '更新しました' : '保存しました');
    renderMasterList();
}

function resetProductForm() {
    const form = document.getElementById('product-form');
    const title = document.getElementById('product-form-title');
    const saveBtn = document.getElementById('product-save-btn');
    const cancelBtn = document.getElementById('cancel-edit');
    const notice = document.getElementById('edit-mode-notice');
    const noticeName = document.getElementById('edit-mode-name');
    const card = document.getElementById('product-form-card');

    if (form) form.reset();
    document.getElementById('prod-id').value = '';
    document.getElementById('kokuyo-search-btn').style.display = 'none';
    document.getElementById('crown-search-btn').style.display = 'none';
    document.getElementById('amazon-search-btn').style.display = 'none';

    if (title) title.textContent = '商品登録';
    if (saveBtn) saveBtn.textContent = '保存';
    if (cancelBtn) cancelBtn.hidden = true;
    if (notice) notice.hidden = true;
    if (noticeName) noticeName.textContent = '';
    if (card) card.classList.remove('is-editing', 'is-editing-flash');
}

function setProductFormEditing(product) {
    const title = document.getElementById('product-form-title');
    const saveBtn = document.getElementById('product-save-btn');
    const cancelBtn = document.getElementById('cancel-edit');
    const notice = document.getElementById('edit-mode-notice');
    const noticeName = document.getElementById('edit-mode-name');
    const card = document.getElementById('product-form-card');

    if (title) title.textContent = '商品を編集中';
    if (saveBtn) saveBtn.textContent = '更新';
    if (cancelBtn) cancelBtn.hidden = false;
    if (notice) notice.hidden = false;
    if (noticeName) noticeName.textContent = product.name || '名称未設定';

    if (card) {
        card.classList.add('is-editing');
        card.classList.remove('is-editing-flash');
        requestAnimationFrame(() => card.classList.add('is-editing-flash'));
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    const nameInput = document.getElementById('prod-name');
    if (nameInput) {
        setTimeout(() => nameInput.focus({ preventScroll: true }), 350);
    }
}

function deleteProduct(id) {
    if (confirm('本当に削除しますか？')) {
        products = products.filter(p => p.id !== id);
        saveData();
        if (Number(document.getElementById('prod-id').value) === id) {
            resetProductForm();
        }
        renderMasterList();
    }
}

function editProduct(id) {
    const p = products.find(p => p.id === id);
    if (!p) return;

    document.getElementById('prod-id').value = p.id;
    document.getElementById('prod-name').value = p.name;
    document.getElementById('prod-price').value = p.price;
    document.getElementById('prod-stock').value = p.stock;
    document.getElementById('prod-barcode').value = p.barcode || '';

    const categoryInput = document.getElementById('prod-category');
    if (categoryInput) categoryInput.value = p.category || '';

    const kokuyoBtn = document.getElementById('kokuyo-search-btn');
    const crownBtn = document.getElementById('crown-search-btn');
    const amazonBtn = document.getElementById('amazon-search-btn');
    if (p.barcode) {
        const barcodeQuery = encodeURIComponent(p.barcode);
        kokuyoBtn.style.display = 'block';
        kokuyoBtn.onclick = () => {
            window.open(`https://www.kokuyo-st.co.jp/search/sp_search.php?flg=1&input_str=${barcodeQuery}`, '_blank', 'noopener');
        };
        crownBtn.style.display = 'block';
        crownBtn.onclick = () => {
            window.open(`https://www.crowngroup.co.jp/office-zukan/list/?p_keyword=${barcodeQuery}`, '_blank', 'noopener');
        };
        amazonBtn.style.display = 'block';
        amazonBtn.onclick = () => {
            window.open(`https://www.amazon.co.jp/s?k=${barcodeQuery}`, '_blank', 'noopener');
        };
    } else {
        kokuyoBtn.style.display = 'none';
        crownBtn.style.display = 'none';
        amazonBtn.style.display = 'none';
    }

    setProductFormEditing(p);
}

function renderMasterList() {
    const container = document.getElementById('master-list');
    container.innerHTML = '';

    products.forEach(p => {
        const div = document.createElement('div');
        div.className = 'product-item';
        const categoryLabel = p.category ? `<span class="category-badge">${escapeHtml(p.category)}</span>` : '';
        div.innerHTML = `
            <div class="product-info">
                <h3>${escapeHtml(p.name)} ${categoryLabel}</h3>
                <div class="product-meta">¥${escapeHtml(p.price)} | 在庫: ${escapeHtml(p.stock)} | ${escapeHtml(p.barcode || '-')}</div>
            </div>
            <div class="actions">
                <button class="btn-secondary" onclick="editProduct(${p.id})">編集</button>
                <button class="btn-secondary" style="color:red;" onclick="deleteProduct(${p.id})">削除</button>
            </div>
        `;
        container.appendChild(div);
    });
}

// --- Search Functions ---
function updateSearchInput(query, shouldSyncInput = true) {
    const normalizedQuery = shouldSyncInput ? normalizeScannedCode(query) : normalizeString(query);
    const searchInput = document.getElementById('search-input');

    if (shouldSyncInput && searchInput) {
        searchInput.value = normalizedQuery;
    }

    performSearch(normalizedQuery);
}

function updateSearchFromScan(scannedCode) {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = '';
    }
    performSearch('');
    updateSearchInput(scannedCode);
}

function setScannerStatus(message, level = 'info') {
    const status = document.getElementById('scanner-status');
    if (!status) return;

    status.textContent = message;
    status.dataset.level = level;
}

function confirmScanCandidate(scanState, decodedText, decodedResult, now = Date.now()) {
    const scannedCode = normalizeScannedCode(decodedText);

    if (!isValidScannedBarcodeCandidate(scannedCode, decodedResult)) {
        scanState.code = '';
        scanState.count = 0;
        scanState.lastSeenAt = 0;
        setScannerStatus('番号を確認できません。バーコードを1つだけ中央に入れてください。', 'warn');
        return '';
    }

    const isSameFreshCandidate = scanState.code === scannedCode
        && now - scanState.lastSeenAt <= SCAN_CONFIRM_MAX_GAP_MS;

    if (!isSameFreshCandidate) {
        scanState.code = scannedCode;
        scanState.count = 1;
        scanState.lastSeenAt = now;
    } else {
        scanState.count += 1;
        scanState.lastSeenAt = now;
    }

    if (scanState.count < SCAN_CONFIRM_REQUIRED) {
        setScannerStatus(`${scannedCode} を確認中 ${scanState.count}/${SCAN_CONFIRM_REQUIRED}`, 'info');
        return '';
    }

    setScannerStatus(`${scannedCode} を読み取りました`, 'success');
    return scannedCode;
}

function performSearch(query) {
    const container = document.getElementById('search-results');
    container.innerHTML = '';

    if (!query) return;

    // Normalize query (NFKC + lowercase)
    const searchRef = normalizeString(query).toLowerCase();
    const barcodeRef = normalizeBarcode(query);
    const fullBarcodeQuery = isFullBarcodeQuery(query);

    const hits = products.filter(p => {
        const barcodeHit = barcodeMatches(p.barcode, barcodeRef);
        if (fullBarcodeQuery) return barcodeHit;

        const normName = normalizeString(p.name).toLowerCase();
        return normName.includes(searchRef) || barcodeHit;
    });

    if (hits.length === 0) {
        if (/^\d+$/.test(barcodeRef) && barcodeRef.length > 8) {
            const encodedQuery = encodeURIComponent(barcodeRef);
            container.innerHTML = `
                <div style="text-align:center; padding: 1rem;">
                    <p style="color: var(--secondary-color); margin-bottom: 1rem;">アプリ内に見つかりませんでした</p>
                    <div class="row" style="gap:5px; justify-content:center; flex-wrap: wrap;">
                        <a href="https://www.kokuyo-st.co.jp/search/sp_search.php?flg=1&input_str=${encodedQuery}" target="_blank" rel="noopener" class="btn-secondary" style="text-decoration:none; display:inline-block; font-size: 0.7rem; flex: 1; text-align: center;">
                            コクヨ ↗
                        </a>
                        <a href="https://www.crowngroup.co.jp/office-zukan/list/?p_keyword=${encodedQuery}" target="_blank" rel="noopener" class="btn-secondary" style="text-decoration:none; display:inline-block; font-size: 0.7rem; flex: 1; text-align: center;">
                            オフィス図鑑 ↗
                        </a>
                        <a href="https://www.amazon.co.jp/s?k=${encodedQuery}" target="_blank" rel="noopener" class="btn-secondary" style="text-decoration:none; display:inline-block; font-size: 0.7rem; flex: 1; text-align: center;">
                            Amazon ↗
                        </a>
                    </div>
                </div>
             `;
        } else {
            container.innerHTML = '<p style="text-align:center; color: var(--secondary-color);">見つかりませんでした</p>';
        }
        return;
    }

    hits.forEach(p => {
        const div = document.createElement('div');
        div.className = `product-item ${p.stock <= 3 ? 'low-stock' : ''}`;
        const categoryLabel = p.category ? `<span class="category-badge">${escapeHtml(p.category)}</span>` : '';
        div.innerHTML = `
            <div class="product-info" style="flex: 1;">
                <h3>${escapeHtml(p.name)} ${categoryLabel}</h3>
                <div class="product-meta">¥${escapeHtml(p.price)} | ${escapeHtml(p.barcode || '-')}</div>
            </div>
            <div class="stock-control" style="display: flex; align-items: center; gap: 0.5rem;">
                <button class="stock-btn" onclick="updateStockFromSearch(${p.id}, -1)">-</button>
                <span class="stock-val" id="search-stock-val-${p.id}">${escapeHtml(p.stock)}</span>
                <button class="stock-btn" onclick="updateStockFromSearch(${p.id}, 1)">+</button>
            </div>
            <button class="btn-secondary" style="margin-left: 0.5rem; font-size: 0.8rem;" onclick="editProductFromSearch(${p.id})">編集</button>
        `;
        container.appendChild(div);
    });
}

// --- Inventory Functions ---
function renderInventory(filterText = '') {
    const container = document.getElementById('inventory-list');
    container.innerHTML = '';

    const categoryFilter = document.getElementById('inventory-category-filter');
    const selectedCategory = categoryFilter ? categoryFilter.value : '';

    const searchRef = normalizeString(filterText).toLowerCase();
    const barcodeRef = normalizeBarcode(filterText);
    const fullBarcodeQuery = isFullBarcodeQuery(filterText);
    const filtered = products.filter(p => {
        const barcodeHit = barcodeMatches(p.barcode, barcodeRef);

        let matchText = true;
        if (filterText) {
            if (fullBarcodeQuery) {
                matchText = barcodeHit;
            } else {
                const normName = normalizeString(p.name).toLowerCase();
                matchText = normName.includes(searchRef) || barcodeHit;
            }
        }
        const matchCategory = !selectedCategory || p.category === selectedCategory;
        return matchText && matchCategory;
    });

    filtered.forEach(p => {
        const div = document.createElement('div');
        div.className = `product-item ${p.stock <= 3 ? 'low-stock' : ''}`;
        const categoryLabel = p.category ? `<span class="category-badge">${escapeHtml(p.category)}</span>` : '';
        div.innerHTML = `
            <div class="product-info">
                <h3>${escapeHtml(p.name)} ${categoryLabel}</h3>
                <div class="product-meta stock-meta">現在庫: ${escapeHtml(p.stock)}</div>
            </div>
            <div class="stock-control">
                <button class="stock-btn" onclick="updateStock(${p.id}, -1)">-</button>
                <span class="stock-val" id="stock-val-${p.id}">${escapeHtml(p.stock)}</span>
                <button class="stock-btn" onclick="updateStock(${p.id}, 1)">+</button>
            </div>
        `;
        container.appendChild(div);
    });
}

function refreshStockDisplay(id, stock) {
    [`stock-val-${id}`, `search-stock-val-${id}`].forEach(elementId => {
        const valSpan = document.getElementById(elementId);
        if (!valSpan) return;

        valSpan.innerText = stock;
        const item = valSpan.closest('.product-item');
        if (item) {
            item.classList.toggle('low-stock', stock <= 3);
            const stockMeta = item.querySelector('.stock-meta');
            if (stockMeta) stockMeta.innerText = `現在庫: ${stock}`;
        }
    });
}

function appendStockLog(product, actualDelta) {
    const logs = getStockLogs();
    logs.push({
        timestamp: new Date().toLocaleString('ja-JP'),
        productId: product.id,
        name: product.name,
        delta: actualDelta > 0 ? `+${actualDelta}` : `${actualDelta}`,
        resultStock: product.stock,
        barcode: product.barcode || ''
    });
    saveStockLogs(logs);
}

function changeProductStock(id, delta) {
    const p = products.find(p => p.id === id);
    if (!p) return;

    const previousStock = Math.max(0, Number(p.stock) || 0);
    const nextStock = Math.max(0, previousStock + delta);
    const actualDelta = nextStock - previousStock;

    if (actualDelta === 0) {
        refreshStockDisplay(id, previousStock);
        return;
    }

    p.stock = nextStock;
    if (!saveData()) {
        p.stock = previousStock;
        refreshStockDisplay(id, previousStock);
        return;
    }

    appendStockLog(p, actualDelta);
    refreshStockDisplay(id, p.stock);
}

function updateStock(id, delta) {
    changeProductStock(id, delta);
}

// Update stock from search results and refresh UI
function updateStockFromSearch(id, delta) {
    changeProductStock(id, delta);
}

// Edit product from search results
function editProductFromSearch(id) {
    navigateToView('view-master');
    requestAnimationFrame(() => editProduct(id));
}

// --- Barcode Scanner ---
async function startScanner(targetInputId) {
    const modal = document.getElementById('scanner-modal');
    modal.style.display = 'flex'; // Show modal

    await stopScanner(false);
    modal.style.display = 'flex';
    initScanner(targetInputId);
}

function initScanner(targetInputId) {
    const html5QrCode = new Html5Qrcode("reader", {
        formatsToSupport: getSupportedScannerFormats(),
        useBarCodeDetectorIfSupported: true,
        experimentalFeatures: {
            useBarCodeDetectorIfSupported: true
        },
        verbose: false
    });
    html5QrcodeScanner = html5QrCode;
    let scanCompleted = false;
    const scanState = { code: '', count: 0, lastSeenAt: 0 };
    setScannerStatus('バーコードを1つだけ中央に入れてください。同じ番号を3回確認します。');

    const config = {
        fps: 15,
        qrbox: getScannerQrbox,
        aspectRatio: getScannerAspectRatio()
    };

    html5QrCode.start(getScannerCameraConfig(), config, (decodedText, decodedResult) => {
        if (scanCompleted) return;
        console.log(`Code matched = ${decodedText}`, decodedResult);
        const scannedCode = confirmScanCandidate(scanState, decodedText, decodedResult);
        if (!scannedCode) return;

        const input = document.getElementById(targetInputId);
        if (input) {
            scanCompleted = true;
            input.value = scannedCode;

            // Dispatch events with bubbling enabled to ensure listeners catch them
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));

            // Explicitly trigger search if it's the search input
            // This is a failsafe in case the event listeners don't fire or propagate as expected
            if (targetInputId === 'search-input') {
                updateSearchFromScan(scannedCode);
            }
        }

        stopScanner();
    }, (errorMessage) => {
        // parse error, ignore it.
    })
        .then(() => {
            optimizeScannerCamera(html5QrCode);
            setTimeout(() => setupScannerTorchControl(html5QrCode), 500);
        })
        .catch(err => {
            console.error("Error starting scanner", err);
            setScannerStatus('カメラの起動に失敗しました。', 'warn');
            alert('カメラの起動に失敗しました。権限を確認してください。');
            setScannerModalVisible(false); // Hide on error
            html5QrcodeScanner = null;
        });
}

function setScannerModalVisible(isVisible) {
    const modal = document.getElementById('scanner-modal');
    if (modal) modal.style.display = isVisible ? 'flex' : 'none';
}

function clearScannerReader() {
    const reader = document.getElementById('reader');
    if (reader) reader.innerHTML = '';

    const torchBtn = document.getElementById('scanner-torch-btn');
    if (torchBtn) {
        torchBtn.style.display = 'none';
        torchBtn.onclick = null;
        torchBtn.disabled = false;
        torchBtn.textContent = 'ライト ON';
    }
}

async function stopScanner(shouldHideModal = true) {
    if (scannerStopPromise) {
        await scannerStopPromise;
        if (shouldHideModal) setScannerModalVisible(false);
        return;
    }

    const scanner = html5QrcodeScanner;
    html5QrcodeScanner = null;

    scannerStopPromise = (async () => {
        if (scanner) {
            try {
                await scanner.stop();
            } catch (err) {
                console.warn("Failed to stop scanner cleanly", err);
            }

            try {
                scanner.clear();
            } catch (err) {
                console.warn("Failed to clear scanner cleanly", err);
            }
        }

        clearScannerReader();
        if (shouldHideModal) setScannerModalVisible(false);
    })();

    try {
        await scannerStopPromise;
    } finally {
        scannerStopPromise = null;
    }
}

// --- GAS Integration ---
function submitGasFormFallback(url, payload) {
    return new Promise((resolve, reject) => {
        const iframeId = `gas-target-iframe-${Date.now()}`;
        const iframe = document.createElement('iframe');
        iframe.id = iframeId;
        iframe.name = iframeId;
        iframe.style.display = 'none';

        const form = document.createElement('form');
        form.method = 'POST';
        form.action = url;
        form.target = iframeId;
        form.style.display = 'none';

        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'data';
        input.value = JSON.stringify(payload);
        form.appendChild(input);

        let settled = false;
        const cleanup = () => {
            if (form.parentNode) document.body.removeChild(form);
            if (iframe.parentNode) document.body.removeChild(iframe);
        };
        const finish = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
        };

        iframe.onload = finish;
        document.body.appendChild(iframe);
        document.body.appendChild(form);

        try {
            form.submit();
            setTimeout(finish, 4000);
        } catch (error) {
            settled = true;
            cleanup();
            reject(error);
        }
    });
}

async function downloadFromGas() {
    const url = getCurrentGasUrl();
    if (!url) return alert('GAS Webアプリ URLを設定してください');

    if (!confirm('クラウドからデータを読み込みますか？\n端末内のデータは上書きされます。')) return;

    const btn = document.getElementById('gas-download-btn');
    const originalText = btn.innerText;
    btn.innerText = '受信中...';
    btn.disabled = true;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        if (data && data.status === 'error') throw new Error(data.message || 'GAS error');

        const productData = (data.products) ? data.products : data;

        if (Array.isArray(productData)) {
            products = productData.map((p, index) => normalizeProduct(p, Date.now() + index)).filter(p => p.name);
            if (!saveData()) return;

            categories = mergeCategories(Array.isArray(data.categories) ? data.categories : [], products);
            if (!saveCategories()) return;

            renderCategoryList();
            renderCategoryDropdowns();
            renderMasterList();
            renderInventory();
            alert(`読み込み完了:\n商品: ${products.length}件\nカテゴリ: ${categories.length}件`);
        } else {
            alert('データ形式が不正です');
        }
    } catch (error) {
        console.error(error);
        alert('読み込みに失敗しました:\n' + error.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

async function uploadToGas() {
    const url = getCurrentGasUrl();
    if (!url) return alert('GAS Webアプリ URLを設定してください');

    if (!confirm('クラウドへデータを保存（上書き）しますか？')) return;

    const btn = document.getElementById('gas-upload-btn');
    const originalText = btn.innerText;
    btn.innerText = '送信中...';
    btn.disabled = true;

    try {
        const logs = getStockLogs();
        const payload = {
            products: products,
            categories: categories,
            logs: logs
        };
        const body = new URLSearchParams();
        body.set('data', JSON.stringify(payload));

        let result;
        try {
            const response = await fetch(url, {
                method: 'POST',
                body
            });
            if (!response.ok) throw new Error('Network response was not ok');
            result = await response.json();
        } catch (fetchError) {
            console.warn('Fetch upload failed, falling back to form POST', fetchError);
            await submitGasFormFallback(url, payload);
            alert('送信結果を確認できないため、在庫履歴は端末内に残しました。\nスプレッドシート側に反映されているか確認してください。');
            return;
        }

        if (!result || result.status !== 'success') {
            throw new Error((result && result.message) || 'GASから成功応答が返りませんでした');
        }

        localStorage.removeItem('inventory_app_logs');

        alert(`データを送信しました。\n商品: ${result.count ?? products.length}件\n履歴: ${result.logCount ?? logs.length}件`);
    } catch (e) {
        console.error(e);
        alert('送信に失敗したため、在庫履歴は端末内に残しました:\n' + e.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

// 強制リフレッシュボタンの追加
document.addEventListener('DOMContentLoaded', () => {
    const forceUpdateBtn = document.getElementById('force-update-btn');
    if (forceUpdateBtn) {
        forceUpdateBtn.addEventListener('click', async () => {
            if (confirm('すべての情報をリフレッシュして最新版を取得します。よろしいですか？（データ自体はlocalStorageに残ります）')) {
                try {
                    // 1. Unregister all service workers
                    if ('serviceWorker' in navigator) {
                        const registrations = await navigator.serviceWorker.getRegistrations();
                        for (let registration of registrations) {
                            await registration.unregister();
                        }
                    }

                    // 2. Clear all caches
                    if ('caches' in window) {
                        const cacheNames = await caches.keys();
                        for (let cacheName of cacheNames) {
                            await caches.delete(cacheName);
                        }
                    }

                    // 3. Hard reload
                    alert('クリアしました。アプリを再読み込みします。');
                    window.location.reload(true);
                } catch (err) {
                    console.error('Force update failed:', err);
                    alert('更新に失敗しました: ' + err);
                }
            }
        });
    }
});
