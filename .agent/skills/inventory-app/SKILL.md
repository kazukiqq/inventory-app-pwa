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
4.  **設定 (`#view-settings`)**: APIキー設定、CSV入出力、GAS連携、**強制更新ボタン**

**操作**:
- 下部ナビゲーションボタンでの切り替え。
- **スワイプ操作**: 画面上のどこでも（コンテンツのない場所でも）左右スワイプで隣接するタブへ移動可能。
    - 検知範囲：`document` 全体（`screenX` を使用）。
    - 感度：30px（短いスワイプでも反応）。
    - 競合回避：`INPUT`, `TEXTAREA`, `SELECT` 要素、および特定のボタン（`.stock-btn`, `.nav-btn`）の上ではスワイプナビゲーションを無効化。
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
    - **設定**: 読み取り精度と利便性のバランスのため、以下のフォーマットに対応させています。
        - `EAN_13`, `EAN_8` (JANコード)
        - `UPC_A`, `UPC_E`
        - `CODE_128`, `CODE_39`

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
- **現在のバージョン**: v1.2.13
- **ヘッダーデザイン**: 濃い青色 (`#3b82f6`) の背景に白文字で「在庫管理」、白いバッジで「v1.2.13 最新」と表示。

### 検索機能
- **正規化**: 検索キーワードと対象データ（商品名・バーコード）は `NFKC` 正規化を行ってから比較します。これにより、全角・半角（英数字、カタカナ）の揺れを吸収して検索可能です。

### UI/UX
- **スワイプ移動**: 画面を左右にスワイプすることで、タブ（検索 ⇔ 棚卸 ⇔ 登録 ⇔ 設定）を切り替え可能です。X (Twitter) のような操作感を目指し、切り替え時に触覚フィードバック (Haptic Feedback) が発生します。

### PWA更新管理
- **キャッシュ戦略**:
    - `index.html`（メインページ）: **Network First**（常にサーバーを確認し、オフライン時のみキャッシュを使用）
    - その他の資産（CSS, JS, 画像）: **Cache First**（高速化のためキャッシュ優先）
- **Service Worker登録**:
    - `{ updateViaCache: 'none' }` を使用してネットワークを毎回確認。
    - 登録URLにはビルドIDを付与（例：`sw.js?build=1.1.3-rev3`）。
- **更新フロー**:
    1. `onupdatefound` で新しいSWを検知。
    2. ユーザーに `confirm` で確認。
    3. `SKIP_WAITING` メッセージをSWに送信。
    4. `controllerchange` イベントでページをリロード。
- **強制更新ボタン** (`#force-update-btn`):
    - 設定画面の最下部に配置。
    - 押すと全てのService Workerを登録解除し、全キャッシュを削除してからリロード。
    - キャッシュ問題が解消されない場合の最終手段。

## 開発・保守ルール

### UI/UX
- **Vanilla CSS**: CSS変数 (`--primary-color` 等) を活用
- **レスポンシブ**: スマホでの利用（カメラ・タッチ操作・スワイプ）を最優先
- **touch-action**: `body` に `touch-action: none` を設定し、JS側でタッチイベントを完全制御

### コード規約
- **Vanilla JS**: ES6+ (Arrow functions, async/await, Template literals)
- **Service Worker**: 
    - 静的資産の追加時は `sw.js` の `ASSETS` 配列を更新。
    - 大規模な変更時は `sw.js` の `CACHE_NAME` を更新すること（現在: `inventory-app-v4`）。
    - ビルドIDを更新してキャッシュ破棄を促す。
