import { defineConfig } from 'vitest/config';

// Integration tests run against an in-memory SQLite DB (DB_PATH=:memory:),
// so the project's database.sqlite is never touched.
export default defineConfig({
  test: {
    globals: true,
    include: ['tests/integration/**/*.test.js'],
    fileParallelism: false,
    sequence: {
      files: [
        'tests/integration/order-flow.test.js',
        'tests/integration/payment-flow.test.js',
      ],
    },
    hookTimeout: 10000,
    env: {
      NODE_ENV: 'test',
      DB_PATH: ':memory:',
      JWT_SECRET: 'integration-test-jwt-secret',
      BASE_URL: 'http://localhost:3001',
      ADMIN_EMAIL: 'admin@hexschool.com',
      ADMIN_PASSWORD: '12345678',
      ECPAY_MERCHANT_ID: '3002607',
      ECPAY_HASH_KEY: 'pwFHCqoQZGmho4w6',
      ECPAY_HASH_IV: 'EkRm7iFT261dpevs',
      ECPAY_ENV: 'staging',
    },
  },
});
