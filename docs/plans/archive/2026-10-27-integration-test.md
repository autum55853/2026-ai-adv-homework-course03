# Integration Test 計畫

## Context
專案現有測試共用 `database.sqlite`，無清理、有順序依賴，且無庫存扣除、購物車清空、交易回滾、綠界付款頁之驗證。
目標：新增獨立（記憶體 SQLite）之 Integration Test，`npm run test:integration` 可跑，不碰原 DB。

## 探勘所得（關鍵）
- `src/database.js` 路徑寫死 `../database.sqlite`，import 即初始化 + seed → 須加 `DB_PATH` 覆寫。
- `app.js` 僅 export app（不 listen）；JWT_SECRET 於請求時讀 `process.env`，測試須自設。
- `NODE_ENV=test` 時 admin seed bcrypt 1 round（加速）。
- 現有 `vitest.config.js` 無 include/exclude，新目錄會被 `test:unit` 撈到 → 須 exclude。
- seed 商品 `products[0]` 不確定 → 測試自建商品，庫存可控。
- 訂單 API：`POST /api/orders` 需 JWT；body `{recipientName, recipientEmail, recipientAddress, deliveryMethod:'home'|'cvs', isRush?}`；運費規則見 `src/utils/shipping.js`（home 120 / cvs 60 / ≥1500 免基本運費 / 離島 +200 / 急件 +250）。
- 失敗路徑：`CART_EMPTY`、`STOCK_INSUFFICIENT`、`VALIDATION_ERROR`（皆 400，transaction 前即檢查）。

## 變更清單
1. `src/database.js`：`const dbPath = process.env.DB_PATH || path.join(__dirname,'..','database.sqlite')`（僅此一行，支援 `:memory:`）。
2. `vitest.integration.config.js`（新）：`include: tests/integration/**/*.test.js`、`fileParallelism:false`、`test.env`：`NODE_ENV=test`、`DB_PATH=:memory:`、`JWT_SECRET=<測試專用值>`、`ADMIN_EMAIL/ADMIN_PASSWORD`、`BASE_URL`、ECPay 測試值。因 env 先於 dotenv，`.env` 不會覆蓋。
3. `vitest.config.js`：加 `exclude: ['tests/integration/**', 'node_modules/**']`，避免 `test:unit` 混入。
4. `package.json`：加 `"test:integration": "vitest run --config vitest.integration.config.js"`。（CLAUDE.md 稱 `npm run test`，實為 `test:unit`；另詢是否補 `test` 別名，未經批准不改。）
5. `tests/integration/helpers.js`（新）：重用 `tests/setup.js` 之 `app/request/registerUser`；`createProduct({price,stock})` 以 `db` 直插；`resetData()` 清 `cart_items/order_items/orders`、非 admin users、測試商品；`addToCart`。
6. `tests/integration/order-flow.test.js`（新）：
   - **主流程**：註冊會員 → `GET /api/products`/`:id` → `POST /api/cart` → `POST /api/orders`；斷言 201、`{data,error:null,message}`、DB `orders` 一筆、`order_items` 快照（name/price/qty）、`shipping_fee`、`total_amount = subtotal + fee`、`status=pending`、`order_no` 格式。
   - **運費參數化**：home 未滿額 120、cvs 60、滿 1500 免基本費、離島 +200、急件 +250；對照 `calculateShippingFee`。
   - **庫存**：下單後 `products.stock` 恰減購買量。
   - **購物車**：下單後 `GET /api/cart` items 空、DB 無該 user 之 cart_items。
   - **失敗不留痕**：庫存不足(400 `STOCK_INSUFFICIENT`)、購物車空(`CART_EMPTY`)、缺欄位/非法 deliveryMethod(`VALIDATION_ERROR`)、未登入(401) → `orders/order_items` 筆數不變、庫存不變、購物車保留。
   - **交易回滾**：測試內建 SQLite trigger（對特定測試商品 `UPDATE products` 時 `RAISE(ABORT)`），令扣庫存步驟在訂單與品項已寫入後失敗 → 斷言回應 500、無訂單/品項殘留、庫存不變、購物車仍在；finally 內 `DROP TRIGGER`。
7. `tests/integration/payment-flow.test.js`（新，綠界）：
   - `GET /ecpay/payment/:orderId`：200、HTML 含 `AioCheckOut`、`MerchantTradeNo`、`TotalAmount`=訂單總額；擷取欄位以 `verifyCheckMacValue` 驗證 CheckMacValue 正確；不存在訂單 404；非 pending 導向 `/orders/:id`。
   - `PATCH /api/orders/:id/pay`：success→`paid`、fail→`failed`、重複付款 400 `INVALID_STATUS`；付款後庫存維持扣除。
   - 不測 `check-payment`（會真實連綠界，違反隔離）；`/ecpay/notify` 後端無此路由，僅於文件註記缺口。
8. `.env.example` 補 `DB_PATH=`註解（可選覆寫，預設 database.sqlite）。專案無 Dockerfile / `.github/workflows`，無需同步。
9. `docs/TESTING.md` 補 Integration 章節；`docs/CHANGELOG.md` 記一筆；本計畫依規寫入 `docs/plans/<日期>-integration-test.md`，完成後移 `archive/`。

## 不做
- 不改既有 7 個測試檔、不改業務碼（僅 database.js 一行）。
- 瀏覽器前端 E2E（Playwright/chrome-devtools）不在此範圍；「前端操作」以 API 動線模擬。

## 驗證
1. `npm run test:integration` 全綠，貼輸出。
2. `npm run test:unit` 仍全綠（確認 exclude 生效、現有測試未受影響）。
3. 跑前後 `ls -l database.sqlite*` 與 `git status` 確認原 DB 未被修改。
4. 變異驗證：暫時破壞（如移除扣庫存 / 清購物車），確認對應測試轉紅，再還原。
5. 連跑兩次確認可重複（無殘留）。
