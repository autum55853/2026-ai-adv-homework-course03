# 運費計算功能

## Context

現有花卉電商結帳流程只算商品小計，`total_amount` 不含運費；`checkout.ejs` 雖有顯示「運費」，但數字是寫死的假邏輯（滿 500 免運、否則 150），跟需求表的規則（宅配 120／超商 60／滿 1,500 免基本運費／偏遠 +200／急件 +250）完全對不上，且完全沒有寫入訂單、不影響實際金額。

目標：把運費規則封裝成 `src/utils/shipping.js`（可獨立單元測試的純函式模組），整合進 `POST /api/orders` 的建立流程，讓訂單 `total_amount` 正確含運費，並讓前端結帳頁可選擇配送方式／急件、看到正確金額。

**已與使用者確認的規則**：
1. 滿 1,500 元小計：宅配與超商取貨「兩種配送方式都免」基本運費（免的是 120 或 60，依所選方式）。
2. 偏遠地區 +200、當日急件 +250：**不受免運門檻影響**，只要符合條件就收取（即使基本運費因滿額而免，加成費用仍要收）。
3. 偏遠地區判定：**依收件地址關鍵字自動判斷**（目前 `recipient_address` 只是自由輸入文字，無結構化縣市欄位），關鍵字清單放在 `shipping.js` 內的 config 常數，之後可再擴充維護。

## 核心模組：`src/utils/shipping.js`

比照 `src/utils/ecpay.js` 的風格（純函式、頂部 config 常數、`module.exports` 具名匯出，不用 class）：

```js
const SHIPPING_CONFIG = {
  HOME_DELIVERY_FEE: 120,
  CVS_PICKUP_FEE: 60,
  FREE_SHIPPING_THRESHOLD: 1500,
  REMOTE_AREA_FEE: 200,
  RUSH_FEE: 250,
};

const REMOTE_AREA_KEYWORDS = [ /* 離島、山地鄉關鍵字，見下方說明 */ ];

function isRemoteArea(address) { ... }          // 關鍵字比對 recipientAddress
function calculateShippingFee({ deliveryMethod, subtotal, address, isRush }) { ... }
// 回傳 { baseFee, remoteFee, rushFee, totalFee, isFreeShipping, isRemote }
// deliveryMethod 不是 'home'/'cvs' 時 throw Error（比照 ecpay.js 的錯誤處理慣例）

module.exports = { calculateShippingFee, isRemoteArea, SHIPPING_CONFIG, REMOTE_AREA_KEYWORDS };
```

`REMOTE_AREA_KEYWORDS` 放常見離島與山地鄉關鍵字（金門、連江/馬祖、澎湖、綠島、蘭嶼、小琉球、烏來、復興區、尖石、五峰、仁愛鄉、信義鄉、魚池鄉…），用 `address.includes(keyword)` 比對。這份清單不求窮盡，註記「依實際配送商偏遠地區名單擴充」。

殘餘風險：關鍵字比對無法涵蓋所有偏遠里/村層級（例如某些非山地鄉但實際偏遠的村里），比手動勾選準確率低，但符合使用者選定的「自動判斷」方向，且實作/維運成本低。

## 整合進訂單建立流程

檔案：`src/routes/orderRoutes.js`（`POST /api/orders`，目前第 81-180 行）

1. `require('../utils/shipping')` 取得 `calculateShippingFee`
2. `req.body` 新增兩個欄位：`deliveryMethod`（必填，`'home'` 或 `'cvs'`）、`isRush`（選填布林，預設 `false`）。驗證失敗回傳既有風格的 `VALIDATION_ERROR`
3. 原本的 `totalAmount` 計算改名為 `subtotal`（商品小計，邏輯不變）
4. 呼叫 `calculateShippingFee({ deliveryMethod, subtotal, address: recipientAddress, isRush })`，算出運費明細；`totalAmount = subtotal + shipping.totalFee`
5. `INSERT INTO orders` 新增欄位：`delivery_method`、`is_rush`、`is_remote`、`shipping_fee`（`total_amount` 維持「含運費總額」的語意不變，前端用 `total_amount - shipping_fee` 可反推小計）
6. POST 回應手動列欄位的地方（第 168-179 行）補上 `shipping_fee`、`delivery_method`、`is_rush`、`is_remote`
7. 其餘端點（`GET /:id`、`PATCH /:id/pay`、`POST /:id/check-payment`）用 `...order`/`...updated` 展開整列資料，新欄位會自動帶出，不用額外改動；`GET /api/orders`（列表）維持現狀不動（非必要不擴充）
8. 同步更新 `POST /api/orders` 的 `@openapi` JSDoc（第 18-80 行）：`requestBody` 補 `deliveryMethod`（enum `[home, cvs]`）、`isRush`（boolean），回應 schema 補 `shipping_fee` 等欄位

ECPay 串接（`src/utils/ecpay.js` 的 `buildAioFormHtml`）直接讀 `order.total_amount`，已自動含運費，不需改動。

## 資料庫 Schema

檔案：`src/database.js`，比照既有 `merchant_trade_no` 的 migration 慣例（第 71-76 行），在 `initializeDatabase()` 加四段 `ALTER TABLE` + try/catch：

```js
try { db.exec(`ALTER TABLE orders ADD COLUMN delivery_method TEXT NOT NULL DEFAULT 'home'`); } catch (e) {}
try { db.exec(`ALTER TABLE orders ADD COLUMN is_rush INTEGER NOT NULL DEFAULT 0`); } catch (e) {}
try { db.exec(`ALTER TABLE orders ADD COLUMN is_remote INTEGER NOT NULL DEFAULT 0`); } catch (e) {}
try { db.exec(`ALTER TABLE orders ADD COLUMN shipping_fee INTEGER NOT NULL DEFAULT 0`); } catch (e) {}
```

不动 `CREATE TABLE IF NOT EXISTS orders`（維持現有「新表用 CREATE、既有表用 ALTER 補欄位」的既定模式，跟 `merchant_trade_no` 一致）。

## 前端介面

檔案：`views/pages/checkout.ejs`、`public/js/pages/checkout.js`

- 表單新增：配送方式（宅配／超商取貨，radio 或 select，預設宅配）、當日急件（checkbox）
- `form` 新增 `deliveryMethod: 'home'`、`isRush: false`，隨 `recipientAddress` 一起送到 `POST /api/orders`
- 移除現有寫死的「滿 500 免運 150」假邏輯，摘要區改顯示依規則表計算的運費（正確常數：120/60/1500/200/250），並反映偏遠/急件加成字樣
- 此處的運費試算是前端純顯示用途，正式金額仍以後端 `shipping.js` 回傳為準（下單後以 API 回應為準），兩處常數會重複一份——這是刻意的取捨：目前專案前後端沒有共用 config 機制，比照現有 `checkout.ejs` 原本就是把運費門檻寫死在模板裡的既定模式，不為此新增一支預覽用的 API endpoint（避免過度設計）

## 測試

1. **新增 `tests/shipping.test.js`**（純函式單元測試，不依賴 `app`/DB，不用 `require('./setup')`，本專案第一個真正的 unit test）：
   - 宅配 / 超商取貨未達免運門檻 → 120 / 60
   - 小計達 1,500（含邊界值 1500）→ 兩種配送方式基本運費皆為 0
   - 偏遠地區 +200（不受免運影響，與免運同時成立時仍收 200）
   - 當日急件 +250
   - 偏遠 + 急件 + 未達免運 的組合加總
   - 偏遠 + 急件 + 已免運 的組合加總（120/60 變 0，但 200+250 仍收）
   - `deliveryMethod` 非法值 → throw Error
   - `isRemoteArea` 正向（含關鍵字地址）與負向（一般地址）案例
   - 因不依賴其他測試資料，`vitest.config.js` 的 `sequence.files` 不強制要求加入（純函式、無資料依賴），但為維持慣例與 CI 完整度，仍加進陣列尾端
2. **更新 `tests/orders.test.js`**（既有整合測試，按 CLAUDE.md 測試同步規則，API 契約變更須同步修正）：
   - 建立訂單成功的既有測試案例，request body 補上 `deliveryMethod: 'home'`；新增斷言 `shipping_fee` 存在、且 `total_amount - shipping_fee` 等於品項小計加總
   - 空購物車測試的 request body 一併補上 `deliveryMethod`，確保測的仍是「空購物車」情境本身而非被新的驗證錯誤蓋過
   - 新增一筆「缺少 deliveryMethod 回傳 400 VALIDATION_ERROR」的案例
3. 跑 `npm run test` 全綠才算完成（遵守全域除錯規範的驗證誠實性）

## 文件同步

- `src/routes/orderRoutes.js` 的 `POST /api/orders` JSDoc 更新後，執行 `npm run openapi` 重新生成 `openapi.json`
- `docs/FEATURES.md`「訂單管理」段落補充運費欄位與規則說明
- 依專案慣例，先在 `docs/plans/2026-10-21-shipping-fee.md` 記錄本計畫，實作完成、測試全綠後移至 `docs/plans/archive/`

## 驗證方式

1. `npm run test` 全綠（含新增的 `shipping.test.js` 與更新後的 `orders.test.js`）
2. `npm run dev:server` 啟動後，用瀏覽器跑一次真實結帳動線：登入 → 加入商品到購物車（分別測小計 < 1,500 與 >= 1,500 兩種情境）→ 進入 `/checkout` → 切換宅配/超商、勾選當日急件、填入含偏遠關鍵字的地址 → 確認頁面顯示金額與送出後訂單金額一致 → 檢查 `GET /api/orders/:id` 回傳的 `shipping_fee`/`delivery_method`/`is_rush`/`is_remote` 正確
3. `npm run openapi` 確認無錯誤執行完成，`openapi.json` 內 `/api/orders` POST 的 schema 含新欄位
