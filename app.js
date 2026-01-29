// App Logic

// Data State
let products = [];
let html5QrcodeScanner = null;
const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbyEN-GRJaa9qKRnFsryZ9Gcd__cZlc1E9h884sKRZc_f_9HaXilz1YijY0C0ln0J0zwPQ/exec';

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
    // 起動確認用アラート（一度更新されれば確認できるはずです）
    console.log('App version: v1.1.3');

    loadData();
    setupNavigation();
    setupForms();
    renderInventory();
    renderMasterList();

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
            const swUrl = './sw.js?build=1.1.3-rev3';
            navigator.serviceWorker.register(swUrl, { updateViaCache: 'none' })
                .then(reg => {
                    console.log('SW Registered: v1.1.3-rev3');

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

// --- Data Management ---
function loadData() {
    const data = localStorage.getItem('inventory_app_products');
    if (data) {
        products = JSON.parse(data);
    } else {
        // Initial Dummy Data
        products = [
            { id: Date.now(), name: 'サンプル商品 A', price: 100, stock: 10, barcode: '123456789' },
        ];
        saveData();
    }
}

function saveData() {
    localStorage.setItem('inventory_app_products', JSON.stringify(products));
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

        // Horizontal swipe? (Threshold: 30px)
        if (Math.abs(dX) > 30 && Math.abs(dX) > Math.abs(dY)) {
            const currentView = document.querySelector('.view.active').id;
            const currentIndex = viewIds.indexOf(currentView);

            if (dX < 0 && currentIndex < viewIds.length - 1) {
                navigateToView(viewIds[currentIndex + 1]);
            } else if (dX > 0 && currentIndex > 0) {
                navigateToView(viewIds[currentIndex - 1]);
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
        performSearch(e.target.value);
    });

    // Inventory Search
    document.getElementById('inventory-search-input').addEventListener('input', (e) => {
        renderInventory(e.target.value);
    });

    // Barcode Input Logic for Master Form
    const barcodeInput = document.getElementById('prod-barcode');
    barcodeInput.addEventListener('change', async (e) => {
        const code = e.target.value;
        const kokuyoBtn = document.getElementById('kokuyo-search-btn');
        const crownBtn = document.getElementById('crown-search-btn');
        const amazonBtn = document.getElementById('amazon-search-btn');

        if (code) {
            kokuyoBtn.style.display = 'block';
            kokuyoBtn.onclick = () => {
                window.open(`https://www.kokuyo-st.co.jp/search/sp_search.php?flg=1&input_str=${code}`, '_blank');
            };

            crownBtn.style.display = 'block';
            crownBtn.onclick = () => {
                window.open(`https://www.crowngroup.co.jp/office-zukan/list/?p_keyword=${code}`, '_blank');
            };

            amazonBtn.style.display = 'block';
            amazonBtn.onclick = () => {
                window.open(`https://www.amazon.co.jp/s?k=${code}`, '_blank');
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
    gasUrlInput.value = localStorage.getItem('inventory_app_gas_url') || DEFAULT_GAS_URL;
    gasUrlInput.addEventListener('change', (e) => {
        localStorage.setItem('inventory_app_gas_url', e.target.value.trim());
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
    const header = ['ID', '商品名', '単価', '在庫数', 'バーコード'].join(',');

    // Rows
    const rows = products.map(p => {
        // Escape commas and quotes if necessary
        const escape = (txt) => {
            if (txt === null || txt === undefined) return '';
            const str = String(txt);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };
        return [
            p.id,
            escape(p.name),
            p.price,
            p.stock,
            escape(p.barcode)
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
        const lines = text.split(/\r\n|\n/);

        // Remove header if it looks like a header
        if (lines[0].includes('ID') && lines[0].includes('商品名')) {
            lines.shift();
        }

        let updatedCount = 0;
        let addedCount = 0;

        lines.forEach(line => {
            if (!line.trim()) return;

            const cols = line.split(',').map(c => c.replace(/^"|"$/g, '').replace(/""/g, '"'));

            // Expected: ID, Name, Price, Stock, Barcode
            let id = cols[0] ? parseInt(cols[0]) : Date.now() + Math.random();
            const name = cols[1];
            const price = parseInt(cols[2]) || 0;
            const stock = parseInt(cols[3]) || 0;
            const barcode = cols[4] || '';

            if (!name) return;

            const existingIndex = products.findIndex(p => p.id === id);

            const newProd = { id, name, price, stock, barcode };

            if (existingIndex !== -1) {
                products[existingIndex] = newProd;
                updatedCount++;
            } else {
                products.push(newProd);
                addedCount++;
            }
        });

        saveData();
        renderMasterList();
        renderInventory();
        alert(`読み込み完了:\n更新: ${updatedCount}件\n追加: ${addedCount}件`);
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

    const product = {
        id: idInput.value ? parseInt(idInput.value) : Date.now(),
        name: nameInput.value,
        price: parseInt(priceInput.value) || 0,
        stock: parseInt(stockInput.value) || 0,
        barcode: barcodeInput.value || ''
    };

    if (idInput.value) {
        const index = products.findIndex(p => p.id === product.id);
        if (index !== -1) {
            products[index] = product;
        }
    } else {
        products.push(product);
    }

    saveData();

    document.getElementById('product-form').reset();
    document.getElementById('prod-id').value = '';
    document.getElementById('kokuyo-search-btn').style.display = 'none';
    document.getElementById('crown-search-btn').style.display = 'none';
    document.getElementById('amazon-search-btn').style.display = 'none';
    alert('保存しました');
    renderMasterList();
}

function deleteProduct(id) {
    if (confirm('本当に削除しますか？')) {
        products = products.filter(p => p.id !== id);
        saveData();
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

    const kokuyoBtn = document.getElementById('kokuyo-search-btn');
    const crownBtn = document.getElementById('crown-search-btn');
    const amazonBtn = document.getElementById('amazon-search-btn');
    if (p.barcode) {
        kokuyoBtn.style.display = 'block';
        kokuyoBtn.onclick = () => {
            window.open(`https://www.kokuyo-st.co.jp/search/sp_search.php?flg=1&input_str=${p.barcode}`, '_blank');
        };
        crownBtn.style.display = 'block';
        crownBtn.onclick = () => {
            window.open(`https://www.crowngroup.co.jp/office-zukan/list/?p_keyword=${p.barcode}`, '_blank');
        };
        amazonBtn.style.display = 'block';
        amazonBtn.onclick = () => {
            window.open(`https://www.amazon.co.jp/s?k=${p.barcode}`, '_blank');
        };
    } else {
        kokuyoBtn.style.display = 'none';
        crownBtn.style.display = 'none';
        amazonBtn.style.display = 'none';
    }

    document.getElementById('main-content').scrollTop = 0;
}

function renderMasterList() {
    const container = document.getElementById('master-list');
    container.innerHTML = '';

    products.forEach(p => {
        const div = document.createElement('div');
        div.className = 'product-item';
        div.innerHTML = `
            <div class="product-info">
                <h3>${p.name}</h3>
                <div class="product-meta">¥${p.price} | 在庫: ${p.stock} | ${p.barcode || '-'}</div>
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
function performSearch(query) {
    const container = document.getElementById('search-results');
    container.innerHTML = '';

    if (!query) return;

    const lowerQ = query.toLowerCase();
    const hits = products.filter(p =>
        p.name.toLowerCase().includes(lowerQ) ||
        (p.barcode && p.barcode.includes(lowerQ))
    );

    if (hits.length === 0) {
        if (/^\d+$/.test(query) && query.length > 8) {
            container.innerHTML = `
                <div style="text-align:center; padding: 1rem;">
                    <p style="color: var(--secondary-color); margin-bottom: 1rem;">アプリ内に見つかりませんでした</p>
                    <div class="row" style="gap:5px; justify-content:center; flex-wrap: wrap;">
                        <a href="https://www.kokuyo-st.co.jp/search/sp_search.php?flg=1&input_str=${query}" target="_blank" class="btn-secondary" style="text-decoration:none; display:inline-block; font-size: 0.7rem; flex: 1; text-align: center;">
                            コクヨ ↗
                        </a>
                        <a href="https://www.crowngroup.co.jp/office-zukan/list/?p_keyword=${query}" target="_blank" class="btn-secondary" style="text-decoration:none; display:inline-block; font-size: 0.7rem; flex: 1; text-align: center;">
                            オフィス図鑑 ↗
                        </a>
                        <a href="https://www.amazon.co.jp/s?k=${query}" target="_blank" class="btn-secondary" style="text-decoration:none; display:inline-block; font-size: 0.7rem; flex: 1; text-align: center;">
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
        div.className = 'product-item';
        div.innerHTML = `
            <div class="product-info">
                <h3>${p.name}</h3>
                <div class="product-meta">¥${p.price}</div>
            </div>
            <div class="product-stock" style="text-align:right;">
                <div style="font-size:0.8rem; color: #64748b;">現在庫</div>
                <div style="font-size:1.5rem; font-weight:bold;">${p.stock}</div>
            </div>
        `;
        container.appendChild(div);
    });
}

// --- Inventory Functions ---
function renderInventory(filterText = '') {
    const container = document.getElementById('inventory-list');
    container.innerHTML = '';

    const lowerFilter = filterText.toLowerCase();
    const filtered = products.filter(p => !filterText || p.name.toLowerCase().includes(lowerFilter));

    filtered.forEach(p => {
        const div = document.createElement('div');
        div.className = 'product-item';
        div.innerHTML = `
            <div class="product-info">
                <h3>${p.name}</h3>
                <div class="product-meta">現在庫: ${p.stock}</div>
            </div>
            <div class="stock-control">
                <button class="stock-btn" onclick="updateStock(${p.id}, -1)">-</button>
                <span class="stock-val" id="stock-val-${p.id}">${p.stock}</span>
                <button class="stock-btn" onclick="updateStock(${p.id}, 1)">+</button>
            </div>
        `;
        container.appendChild(div);
    });
}

function updateStock(id, delta) {
    const p = products.find(p => p.id === id);
    if (p) {
        p.stock += delta;
        if (p.stock < 0) p.stock = 0;

        saveData();

        // --- Log Recording ---
        const logs = JSON.parse(localStorage.getItem('inventory_app_logs') || '[]');
        logs.push({
            timestamp: new Date().toLocaleString('ja-JP'),
            productId: p.id,
            name: p.name,
            delta: delta > 0 ? `+${delta}` : `${delta}`,
            resultStock: p.stock,
            barcode: p.barcode || ''
        });
        localStorage.setItem('inventory_app_logs', JSON.stringify(logs));
        // ---------------------

        // Update UI
        const valSpan = document.getElementById(`stock-val-${id}`);
        if (valSpan) valSpan.innerText = p.stock;
    }
}

// --- Barcode Scanner ---
function startScanner(targetInputId) {
    const modal = document.getElementById('scanner-modal');
    modal.style.display = 'flex'; // Show modal

    // Stop existing scanner first if any
    if (html5QrcodeScanner) {
        html5QrcodeScanner.stop().then(() => {
            html5QrcodeScanner.clear();
            html5QrcodeScanner = null;
            initScanner(targetInputId);
        }).catch(() => {
            html5QrcodeScanner = null;
            initScanner(targetInputId);
        });
    } else {
        initScanner(targetInputId);
    }
}

function initScanner(targetInputId) {
    const html5QrCode = new Html5Qrcode("reader");
    html5QrcodeScanner = html5QrCode;

    const config = { fps: 10, qrbox: { width: 250, height: 250 } };

    html5QrCode.start({ facingMode: "environment" }, config, (decodedText, decodedResult) => {
        console.log(`Code matched = ${decodedText}`, decodedResult);

        const input = document.getElementById(targetInputId);
        if (input) {
            input.value = decodedText;
            input.dispatchEvent(new Event('input'));
            input.dispatchEvent(new Event('change'));
        }

        stopScanner();
    }, (errorMessage) => {
        // parse error, ignore it.
    }).catch(err => {
        console.error("Error starting scanner", err);
        alert('カメラの起動に失敗しました。権限を確認してください。');
        document.getElementById('scanner-modal').style.display = 'none'; // Hide on error
        html5QrcodeScanner = null;
    });
}

function stopScanner() {
    if (html5QrcodeScanner) {
        html5QrcodeScanner.stop().then(() => {
            html5QrcodeScanner.clear();
            html5QrcodeScanner = null;
            document.getElementById('scanner-modal').style.display = 'none'; // Hide modal
        }).catch(err => {
            console.error("Failed to stop scanner", err);
            // Force hide even if error
            document.getElementById('scanner-modal').style.display = 'none';
            html5QrcodeScanner = null;
        });
    } else {
        document.getElementById('scanner-modal').style.display = 'none';
    }
}

// --- GAS Integration ---
async function downloadFromGas() {
    const url = localStorage.getItem('inventory_app_gas_url') || DEFAULT_GAS_URL;
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

        const productData = (data.products) ? data.products : data;

        if (Array.isArray(productData)) {
            products = productData;
            saveData();
            renderMasterList();
            renderInventory();
            alert(`読み込み完了: ${productData.length}件`);
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
    const url = localStorage.getItem('inventory_app_gas_url') || DEFAULT_GAS_URL;
    if (!url) return alert('GAS Webアプリ URLを設定してください');

    if (!confirm('クラウドへデータを保存（上書き）しますか？')) return;

    const btn = document.getElementById('gas-upload-btn');
    const originalText = btn.innerText;
    btn.innerText = '送信中...';
    btn.disabled = true;

    // Create a hidden iframe
    const iframeId = 'gas-target-iframe';
    let iframe = document.getElementById(iframeId);
    if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = iframeId;
        iframe.name = iframeId;
        iframe.style.display = 'none';
        document.body.appendChild(iframe);
    }

    // Create a form
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;
    form.target = iframeId;
    form.style.display = 'none';

    // Fetch logs
    const logs = JSON.parse(localStorage.getItem('inventory_app_logs') || '[]');

    // Data input
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'data';
    // Payload: { products: [...], logs: [...] }
    input.value = JSON.stringify({
        products: products,
        logs: logs
    });
    form.appendChild(input);

    document.body.appendChild(form);

    try {
        form.submit();

        // Clear logs after send
        localStorage.removeItem('inventory_app_logs');

        alert('データを送信しました。\n(※数秒後にスプレッドシートを確認してください)');
    } catch (e) {
        alert('送信エラー: ' + e.message);
    } finally {
        setTimeout(() => {
            document.body.removeChild(form);
            btn.innerText = originalText;
            btn.disabled = false;
        }, 1000);
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
