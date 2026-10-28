import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    fileParallelism: false,
    exclude: ['tests/integration/**', 'tests/e2e/**', 'node_modules/**'],
    sequence: {
      files: [
        'tests/auth.test.js',
        'tests/products.test.js',
        'tests/cart.test.js',
        'tests/orders.test.js',
        'tests/adminProducts.test.js',
        'tests/adminOrders.test.js',
        'tests/shipping.test.js',
      ],
    },
    hookTimeout: 10000,
  },
});
