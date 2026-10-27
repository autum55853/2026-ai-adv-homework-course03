const { app, request, registerUser } = require('../setup');
const { v4: uuidv4 } = require('uuid');
const db = require('../../src/database');

const ORDER_BODY = {
  recipientName: '王小花',
  recipientEmail: 'flower@example.com',
  recipientAddress: '台北市中正區測試路 1 號',
  deliveryMethod: 'home',
};

function createProduct({ name, price = 500, stock = 10 } = {}) {
  const id = uuidv4();
  db.prepare('INSERT INTO products (id, name, description, price, stock) VALUES (?, ?, ?, ?, ?)')
    .run(id, name || `測試花束-${Math.random().toString(36).slice(2)}`, 'integration test', price, stock);
  return db.prepare('SELECT * FROM products WHERE id = ?').get(id);
}

function getStock(productId) {
  return db.prepare('SELECT stock FROM products WHERE id = ?').get(productId).stock;
}

function count(table) {
  return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
}

function addToCart(token, productId, quantity = 1) {
  return request(app)
    .post('/api/cart')
    .set('Authorization', `Bearer ${token}`)
    .send({ productId, quantity });
}

function createOrder(token, overrides = {}) {
  return request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...ORDER_BODY, ...overrides });
}

// Remove everything the tests created; keep the seeded admin.
function resetData() {
  db.exec(`
    DELETE FROM order_items;
    DELETE FROM orders;
    DELETE FROM cart_items;
    DELETE FROM users WHERE role != 'admin';
    DELETE FROM products WHERE description = 'integration test';
  `);
}

module.exports = {
  app,
  request,
  db,
  registerUser,
  ORDER_BODY,
  createProduct,
  getStock,
  count,
  addToCart,
  createOrder,
  resetData,
};
