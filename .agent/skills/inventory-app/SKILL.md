---
name: inventory-app-skill
description: 在庫管理アプリの開発・保守用スキル。シングルページアプリケーション(SPA)の構成、データ管理、外部API連携について記述。
---

# 在庫管理アプリ・スキル

このスキルは、ブラウザベースの「在庫管理アプリ」の仕様と開発ガイドラインを提供します。
**重要**: このアプリに関する対話は常に日本語で行ってください。

## プロジェクト概要
HTML/CSS/JSのみで構成される軽量なシングルページアプリケーション（SPA）です。サーバーサイドを持たず、データはブラウザの `localStorage` に保存されます。

### ファイル構成
```
在庫管理アプリ/
├── index.html       # メインファイル（全画面・モーダル含む）
├── app.js           # アプリケーションロジック（データ管理、UI操作、スキャナー）
├── style.css        # スタイル定義
├── sw.js            # Service Worker（キャッシュ・オフライン対応）
└── manifest.json    # PWA用マニフェスト（Webアプリとしてインストール可能）
```

## アーキテクチャ

### 画面遷移
SPAとして実装されており、タブ切り替えで以下のViewを表示します。
1.  **検索 (`#view-search`)**: 商品検索とバーコードスキャン
2.  **棚卸 (`#view-inventory`)**: 在庫数の増減操作
3.  **登録 (`#view-master`)**: 新規商品登録、マスタ一覧・編集
4.  **設定 (`#view-settings`)**: APIキー設定、CSV入出力、GAS連携

**操作**:
- 下部ナビゲーションボタンでの切り替え。
- **スワイプ操作**: 左右スワイプで隣接するタブへ移動。
    - 右から左へスワイプ：次のタブへ。
    - 左から右へスワイプ：前のタブへ。

### バーコードスキャナー
- **モーダル表示**: カメラ起動時は画面中央にオーバーレイモーダルとして表示 (`#scanner-modal`)
- **スキャンボタン**: 検索画面 (`#scan-btn`) と商品登録画面 (`#master-scan-btn`) に配置
- **閉じるボタン**: スキャン中断用 (`#close-scanner-btn`)

### データ管理
- **保存先**: `localStorage` (Key: `inventory_app_products`)
- **データ構造**: JSON配列
    ```json
    [
      {
        "id": 1234567890123,  // ID (タイムスタンプまたはランダム)
        "name": "商品A",       // 商品名
        "price": 100,         // 単価
        "stock": 10,          // 現在庫数
        "barcode": "490000..." // JANコード (推奨) または空文字
      }
    ]
    ```

### 外部ライブラリ
- **[html5-qrcode](https://github.com/mebjas/html5-qrcode)**
    - バーコード読み取りに使用。
    - CDN: `https://unpkg.com/html5-qrcode`
    - カメラ権限が必要。HTTPS環境またはlocalhostでのみ動作。

### 外部API連携
- **Yahoo!ショッピングAPI**: JANコードから商品情報を自動取得
- **Google Apps Script (GAS)**: クラウド同期・ログ記録 (URLは `app.js` 内にハードコード済み)
- **外部検索リンク**:
    - オフィス図鑑: `https://www.crowngroup.co.jp/office-zukan/list/?p_keyword={barcode}`
    - コクヨWeb: `https://www.kokuyo-st.co.jp/search/sp_search.php?flg=1&input_str={barcode}`
    - Amazon: `https://www.amazon.co.jp/s?k={barcode}`

## デプロイと PWA
- **URL**: [https://inventory-app-pwa.vercel.app](https://inventory-app-pwa.vercel.app)
- **GitHub**: [kazukiqq/inventory-app-pwa](https://github.com/kazukiqq/inventory-app-pwa)
- **現在のバージョン**: v1.1.3
- **更新管理**: 
    - ブラウザキャッシュによる更新の遅延・固執を防ぐため、`navigator.serviceWorker.register` 時には `{ updateViaCache: 'none' }` を使用している。
    - 登録URLにはクエリパラメータを付与**しない**（無限ループ防止のため）。
    - ユーザーの承認 (`confirm`) 後、`SKIP_WAITING` を Service Worker に送り、`controllerchange` イベントでページをリロードする方式を採用している。

## 開発・保守ルール

### UI/UX
- **Vanilla CSS**: CSS変数 (`--primary-color` 等) を活用
- **レスポンシブ**: スマホでの利用（カメラ・タッチ操作・スワイプ）を最優先

### コード規約
- **Vanilla JS**: ES6+ (Arrow functions, async/await, Template literals)
- **Service Worker**: 
    - 静的資産の追加時は `sw.js` の `ASSETS` 配列を更新。
    - 大規模な変更時は `sw.js` の `CACHE_NAME` を更新すること。
