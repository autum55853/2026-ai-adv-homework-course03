const {
  app, request, db, registerUser, createProduct, getStock,
  addToCart, createOrder, resetData,
} = require('./helpers');
const { verifyCheckMacValue, ECPAY_CONFIG } = require('../../src/utils/ecpay');

function unescapeHtml(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function parseFormFields(html) {
  const fields = {};
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) {
    fields[m[1]] = unescapeHtml(m[2]);
  }
  return fields;
}

describe('Integration: 訂單付款（綠界）', () => {
  let token;
  let product;
  let order;

  beforeEach(async () => {
    resetData();
    ({ token } = await registerUser());
    product = createProduct({ price: 700, stock: 10 });
    await addToCart(token, product.id, 2);
    const res = await createOrder(token);
    expect(res.status).toBe(201);
    order = res.body.data;
  });

  afterAll(() => resetData());

  const pay = (action, id = order.id, t = token) =>
    request(app).patch(`/api/orders/${id}/pay`).set('Authorization', `Bearer ${t}`).send({ action });

  describe('GET /ecpay/payment/:orderId', () => {
    it('回傳導向綠界之表單，欄位與訂單一致且 CheckMacValue 正確', async () => {
      const res = await request(app).get(`/ecpay/payment/${order.id}`);
      expect(res.status).toBe(200);
      expect(res.type).toBe('text/html');
      expect(res.text).toContain(`action="${ECPAY_CONFIG.aioCheckOutUrl}"`);

      const f = parseFormFields(res.text);
      expect(f.MerchantID).toBe(ECPAY_CONFIG.merchantId);
      expect(f.MerchantTradeNo).toBe(order.order_no.replace(/-/g, ''));
      expect(f.TotalAmount).toBe(String(order.total_amount));
      expect(f.TotalAmount).toBe(String(700 * 2 + 120));
      expect(f.EncryptType).toBe('1');
      expect(verifyCheckMacValue(f, ECPAY_CONFIG.hashKey, ECPAY_CONFIG.hashIV)).toBe(true);
    });

    it('竄改金額後 CheckMacValue 驗證失敗', async () => {
      const res = await request(app).get(`/ecpay/payment/${order.id}`);
      const f = parseFormFields(res.text);
      f.TotalAmount = '1';
      expect(verifyCheckMacValue(f, ECPAY_CONFIG.hashKey, ECPAY_CONFIG.hashIV)).toBe(false);
    });

    it('訂單不存在 → 404', async () => {
      const res = await request(app).get('/ecpay/payment/no-such-order');
      expect(res.status).toBe(404);
    });

    it('訂單已付款 → 導向訂單頁', async () => {
      await pay('success');
      const res = await request(app).get(`/ecpay/payment/${order.id}`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`/orders/${order.id}`);
    });
  });

  describe('PATCH /api/orders/:id/pay', () => {
    it('付款成功 → paid，庫存維持已扣除', async () => {
      const res = await pay('success');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ error: null, message: '付款成功' });
      expect(res.body.data.status).toBe('paid');
      expect(db.prepare('SELECT status FROM orders WHERE id = ?').get(order.id).status).toBe('paid');
      expect(getStock(product.id)).toBe(8);
    });

    it('付款失敗 → failed', async () => {
      const res = await pay('fail');
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('failed');
      expect(db.prepare('SELECT status FROM orders WHERE id = ?').get(order.id).status).toBe('failed');
    });

    it('已非 pending 不可重複付款 → 400 INVALID_STATUS', async () => {
      await pay('success');
      const again = await pay('success');
      expect(again.status).toBe(400);
      expect(again.body).toMatchObject({ data: null, error: 'INVALID_STATUS' });
    });

    it('非法 action → 400 VALIDATION_ERROR，狀態不變', async () => {
      const res = await pay('refund');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(db.prepare('SELECT status FROM orders WHERE id = ?').get(order.id).status).toBe('pending');
    });

    it('他人不可付款我的訂單 → 404', async () => {
      const other = await registerUser();
      const res = await pay('success', order.id, other.token);
      expect(res.status).toBe(404);
      expect(db.prepare('SELECT status FROM orders WHERE id = ?').get(order.id).status).toBe('pending');
    });
  });
});
