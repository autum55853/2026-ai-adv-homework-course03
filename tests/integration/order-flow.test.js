const {
  app, request, db, registerUser, createProduct, getStock, count,
  addToCart, createOrder, resetData,
} = require('./helpers');
const { calculateShippingFee } = require('../../src/utils/shipping');

describe('Integration: 購物車 → 建立訂單', () => {
  let token;
  let userId;

  beforeEach(async () => {
    resetData();
    const reg = await registerUser();
    token = reg.token;
    userId = reg.user.id;
  });

  afterAll(() => resetData());

  describe('主流程', () => {
    it('登入 → 取得商品 → 加入購物車 → 建立訂單，且寫入資料庫', async () => {
      const product = createProduct({ name: '玫瑰花束', price: 600, stock: 10 });

      // 以註冊帳號重新登入，確認會員流程
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: db.prepare('SELECT email FROM users WHERE id = ?').get(userId).email, password: 'password123' });
      expect(login.status).toBe(200);
      expect(login.body).toMatchObject({ error: null });
      const t = login.body.data.token;

      const list = await request(app).get('/api/products?limit=100');
      expect(list.status).toBe(200);
      expect(list.body.error).toBeNull();
      expect(list.body.data.products.map((p) => p.id)).toContain(product.id);

      const detail = await request(app).get(`/api/products/${product.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({ id: product.id, price: 600, stock: 10 });

      const cart = await addToCart(t, product.id, 2);
      expect(cart.status).toBe(200);
      expect(cart.body).toMatchObject({ error: null });
      expect(cart.body.data).toMatchObject({ product_id: product.id, quantity: 2 });

      const res = await createOrder(t);
      expect(res.status).toBe(201);
      expect(res.body.error).toBeNull();
      expect(res.body.message).toBe('訂單建立成功');

      const order = res.body.data;
      expect(order.order_no).toMatch(/^ORD-\d{8}-[A-Z0-9]{5}$/);
      expect(order.status).toBe('pending');
      expect(order.items).toEqual([
        expect.objectContaining({ product_name: '玫瑰花束', product_price: 600, quantity: 2 }),
      ]);

      // 訂單寫入
      const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
      expect(row).toMatchObject({
        user_id: userId,
        recipient_name: '王小花',
        recipient_email: 'flower@example.com',
        delivery_method: 'home',
        status: 'pending',
        shipping_fee: 120,
        total_amount: 1200 + 120,
      });
      expect(row.merchant_trade_no).toBe(order.order_no.replace(/-/g, ''));

      // 品項寫入（快照）
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        product_id: product.id, product_name: '玫瑰花束', product_price: 600, quantity: 2,
      });
    });

    it('多品項：總額 = 各品項小計加總 + 運費', async () => {
      const a = createProduct({ price: 300, stock: 5 });
      const b = createProduct({ price: 450, stock: 5 });
      await addToCart(token, a.id, 2); // 600
      await addToCart(token, b.id, 1); // 450

      const res = await createOrder(token);
      expect(res.status).toBe(201);
      expect(res.body.data.shipping_fee).toBe(120);
      expect(res.body.data.total_amount).toBe(1050 + 120);
      expect(count('order_items')).toBe(2);
    });

    it('下單後商品快照不受日後改價影響', async () => {
      const p = createProduct({ price: 500, stock: 5 });
      await addToCart(token, p.id, 1);
      const res = await createOrder(token);
      db.prepare('UPDATE products SET price = 9999 WHERE id = ?').run(p.id);

      const detail = await request(app)
        .get(`/api/orders/${res.body.data.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(detail.status).toBe(200);
      expect(detail.body.data.items[0].product_price).toBe(500);
    });
  });

  describe('配送費用與總額', () => {
    const cases = [
      { name: '宅配未滿額', price: 500, qty: 1, body: {}, fee: 120 },
      { name: '超商取貨未滿額', price: 500, qty: 1, body: { deliveryMethod: 'cvs' }, fee: 60 },
      { name: '宅配滿額免基本運費', price: 1500, qty: 1, body: {}, fee: 0 },
      { name: '超商取貨滿額免基本運費', price: 800, qty: 2, body: { deliveryMethod: 'cvs' }, fee: 0 },
      { name: '離島加收', price: 500, qty: 1, body: { recipientAddress: '澎湖縣馬公市測試路 1 號' }, fee: 120 + 200 },
      { name: '急件加收', price: 500, qty: 1, body: { isRush: true }, fee: 120 + 250 },
      { name: '滿額 + 離島 + 急件', price: 2000, qty: 1, body: { recipientAddress: '金門縣金城鎮測試路 1 號', isRush: true }, fee: 200 + 250 },
    ];

    it.each(cases)('$name', async ({ price, qty, body, fee }) => {
      const p = createProduct({ price, stock: 10 });
      await addToCart(token, p.id, qty);

      const res = await createOrder(token, body);
      expect(res.status).toBe(201);

      const expected = calculateShippingFee({
        deliveryMethod: body.deliveryMethod || 'home',
        subtotal: price * qty,
        address: body.recipientAddress || '台北市中正區測試路 1 號',
        isRush: !!body.isRush,
      });
      expect(expected.totalFee).toBe(fee); // 規格交叉檢查
      expect(res.body.data.shipping_fee).toBe(fee);
      expect(res.body.data.total_amount).toBe(price * qty + fee);

      const row = db.prepare('SELECT shipping_fee, total_amount FROM orders WHERE id = ?').get(res.body.data.id);
      expect(row).toEqual({ shipping_fee: fee, total_amount: price * qty + fee });
    });
  });

  describe('庫存與購物車', () => {
    it('庫存恰好扣除購買數量', async () => {
      const p = createProduct({ price: 500, stock: 10 });
      await addToCart(token, p.id, 3);
      const res = await createOrder(token);
      expect(res.status).toBe(201);
      expect(getStock(p.id)).toBe(7);
    });

    it('買光庫存 → 庫存為 0', async () => {
      const p = createProduct({ stock: 2 });
      await addToCart(token, p.id, 2);
      expect((await createOrder(token)).status).toBe(201);
      expect(getStock(p.id)).toBe(0);
    });

    it('建立訂單後購物車清空（API 與資料庫）', async () => {
      const p = createProduct({ stock: 10 });
      await addToCart(token, p.id, 1);
      await createOrder(token);

      const cart = await request(app).get('/api/cart').set('Authorization', `Bearer ${token}`);
      expect(cart.status).toBe(200);
      expect(cart.body.data.items).toEqual([]);
      expect(db.prepare('SELECT COUNT(*) AS c FROM cart_items WHERE user_id = ?').get(userId).c).toBe(0);
    });

    it('只清除下單者之購物車，不影響他人', async () => {
      const p = createProduct({ stock: 10 });
      const other = await registerUser();
      await addToCart(token, p.id, 1);
      await addToCart(other.token, p.id, 1);

      await createOrder(token);

      expect(db.prepare('SELECT COUNT(*) AS c FROM cart_items WHERE user_id = ?').get(other.user.id).c).toBe(1);
    });
  });

  describe('失敗時不留下不完整資料', () => {
    function snapshot(productId) {
      return {
        orders: count('orders'),
        orderItems: count('order_items'),
        stock: getStock(productId),
      };
    }

    it('庫存不足 → 400 STOCK_INSUFFICIENT，無訂單、庫存不變、購物車保留', async () => {
      const p = createProduct({ stock: 5 });
      await addToCart(token, p.id, 3);
      // 加入購物車後庫存被他人買走
      db.prepare('UPDATE products SET stock = 2 WHERE id = ?').run(p.id);
      const before = snapshot(p.id);

      const res = await createOrder(token);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ data: null, error: 'STOCK_INSUFFICIENT' });
      expect(snapshot(p.id)).toEqual(before);
      expect(db.prepare('SELECT quantity FROM cart_items WHERE user_id = ?').get(userId).quantity).toBe(3);
    });

    it('多品項其中一項庫存不足 → 其他品項亦不扣庫存', async () => {
      const ok = createProduct({ stock: 10 });
      const bad = createProduct({ stock: 5 });
      await addToCart(token, ok.id, 2);
      await addToCart(token, bad.id, 4);
      db.prepare('UPDATE products SET stock = 1 WHERE id = ?').run(bad.id);

      const res = await createOrder(token);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('STOCK_INSUFFICIENT');
      expect(getStock(ok.id)).toBe(10);
      expect(getStock(bad.id)).toBe(1);
      expect(count('orders')).toBe(0);
      expect(count('order_items')).toBe(0);
    });

    it('購物車為空 → 400 CART_EMPTY，無訂單', async () => {
      const res = await createOrder(token);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ data: null, error: 'CART_EMPTY' });
      expect(count('orders')).toBe(0);
    });

    it.each([
      ['缺少收件人', { recipientName: '' }],
      ['Email 格式錯誤', { recipientEmail: 'not-an-email' }],
      ['缺少地址', { recipientAddress: '' }],
      ['缺少配送方式', { deliveryMethod: undefined }],
      ['不支援的配送方式', { deliveryMethod: 'drone' }],
    ])('參數驗證失敗（%s）→ 400 VALIDATION_ERROR，無訂單、庫存不變、購物車保留', async (_n, override) => {
      const p = createProduct({ stock: 10 });
      await addToCart(token, p.id, 2);
      const before = snapshot(p.id);

      const res = await createOrder(token, override);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ data: null, error: 'VALIDATION_ERROR' });
      expect(snapshot(p.id)).toEqual(before);
      expect(db.prepare('SELECT COUNT(*) AS c FROM cart_items WHERE user_id = ?').get(userId).c).toBe(1);
    });

    it('未帶 token → 401，無訂單', async () => {
      const res = await request(app).post('/api/orders').send({});
      expect(res.status).toBe(401);
      expect(res.body.data).toBeNull();
      expect(count('orders')).toBe(0);
    });

    it('交易中途失敗（訂單與品項已寫入、扣庫存時出錯）→ 全數回滾', async () => {
      const ok = createProduct({ stock: 10 });
      const boom = createProduct({ stock: 10 });
      await addToCart(token, ok.id, 1);
      await addToCart(token, boom.id, 1);
      const before = { orders: count('orders'), orderItems: count('order_items') };

      // 對特定商品之庫存更新強制報錯，模擬交易中途失敗
      db.exec(`
        CREATE TRIGGER it_force_stock_failure BEFORE UPDATE OF stock ON products
        WHEN OLD.id = '${boom.id}'
        BEGIN SELECT RAISE(ABORT, 'forced failure'); END;
      `);

      let res;
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        res = await createOrder(token);
      } finally {
        errSpy.mockRestore();
        db.exec('DROP TRIGGER IF EXISTS it_force_stock_failure');
      }

      expect(res.status).toBe(500);
      expect(res.body.data).toBeNull();
      expect(count('orders')).toBe(before.orders);
      expect(count('order_items')).toBe(before.orderItems);
      expect(getStock(ok.id)).toBe(10); // 先處理之品項庫存亦回復
      expect(getStock(boom.id)).toBe(10);
      expect(db.prepare('SELECT COUNT(*) AS c FROM cart_items WHERE user_id = ?').get(userId).c).toBe(2);
    });
  });

  describe('資料隔離', () => {
    it('無法讀取他人訂單', async () => {
      const p = createProduct({ stock: 5 });
      await addToCart(token, p.id, 1);
      const res = await createOrder(token);
      const other = await registerUser();

      const peek = await request(app)
        .get(`/api/orders/${res.body.data.id}`)
        .set('Authorization', `Bearer ${other.token}`);
      expect(peek.status).toBe(404);
    });
  });
});
