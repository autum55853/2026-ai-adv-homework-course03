import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const missing = ["E2E_EMAIL", "E2E_PASSWORD"].filter((k) => !process.env[k]);
if (missing.length) throw new Error(`Missing env vars: ${missing.join(", ")}`);

const SCREENSHOT_DIR = path.join("tests", "e2e", "screenshots");

test("登入 → 加購 → 結帳 → 綠界網路 ATM 付款 → 訂單已付款", async ({ page }) => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  let orderId;

  await test.step("登入花卉電商", async () => {
    await page.goto("/login");
    // Vue 掛載前登入/註冊表單同時存在於 HTML，以含密碼欄的表單限定範圍
    const loginForm = page.locator("form", { has: page.getByPlaceholder("請輸入密碼") });
    await loginForm.getByPlaceholder("請輸入 Email").fill(process.env.E2E_EMAIL);
    await loginForm.getByPlaceholder("請輸入密碼").fill(process.env.E2E_PASSWORD);
    await loginForm.locator("button[type=submit]").click();
    await page.waitForURL((u) => u.pathname === "/");
  });

  await test.step("選擇商品並加入購物車", async () => {
    const addBtn = page.getByRole("button", { name: "加入購物車" }).first();
    await expect(addBtn).toBeVisible();
    await addBtn.click();
    await page.goto("/cart");
    await expect(page.getByRole("button", { name: "前往結帳" })).toBeVisible();
  });

  await test.step("進入結帳頁面並填寫資料", async () => {
    await page.getByRole("button", { name: "前往結帳" }).click();
    await page.waitForURL("**/checkout");
    await page.getByPlaceholder("請輸入收件人姓名").fill("E2E 測試");
    await page.getByPlaceholder("請輸入 Email").fill(process.env.E2E_EMAIL);
    await page.getByPlaceholder("請輸入收件地址").fill("台北市信義區市府路 1 號");
    await page.locator("input[type=radio][value=home]").check();
  });

  await test.step("建立訂單並前往綠界", async () => {
    // /ecpay/payment/:id 載入即自動 submit 到綠界，page.url() 有競態；
    // 頁面跳轉後 response body 即失效，故用 route 在回應送達瀏覽器前先讀取 orderId
    await page.route("**/api/orders", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      orderId = (await response.json()).data.id;
      await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "確認送出訂單" }).click();
    await page.waitForURL(/payment-stage\.ecpay\.com\.tw/);
    await page.unroute("**/api/orders");
    expect(orderId).toBeTruthy();
  });

  await test.step("綠界：網路 ATM → 台灣土地銀行 → 前往付款", async () => {
    await page.getByText("網路ATM", { exact: false }).first().click();
    await page.getByRole("combobox").selectOption({ label: "台灣土地銀行" });
    await page.getByRole("link", { name: "前往付款" }).click();
  });

  await test.step("關閉提示視窗並於土地銀行測試頁點 Save", async () => {
    const dismiss = page.getByRole("button", { name: /確定|確認|我知道了|關閉|OK/ }).first();
    await dismiss.click({ timeout: 15_000 }).catch(() => {});
    await page.getByRole("button", { name: "Save" }).or(page.locator('input[value="Save"]')).first().click();
  });

  await test.step("等待綠界付款成功並返回商店", async () => {
    await expect(page.getByText(/付款成功|交易成功/).first()).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "ecpay-payment-success.png"), fullPage: true });
    await page
      .getByRole("link", { name: /返回商店/ })
      .or(page.getByRole("button", { name: /返回商店/ }))
      .first()
      .click();
    // 預設等 load 事件，外部資源（CDN/字型）未完成會卡住；改等 domcontentloaded
    await page.waitForURL(new RegExp(`/orders/${orderId}`), { waitUntil: "domcontentloaded" });
  });

  await test.step("驗證訂單顯示「已付款」", async () => {
    // 頁面帶 ?payment=pending 會於載入後自動查詢付款狀態，直接等待「已付款」文字出現
    const paidBadge = page.getByText("已付款", { exact: true });
    await expect(paidBadge).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "order-paid-after-return.png"), fullPage: true });
  });

  await test.step("驗證 API 訂單狀態為 paid", async () => {
    const token = await page.evaluate(() => localStorage.getItem("flower_token"));
    const res = await page.request.get(`/api/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.status).toBe("paid");
  });
});
