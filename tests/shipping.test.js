const { calculateShippingFee, isRemoteArea, SHIPPING_CONFIG } = require('../src/utils/shipping');

describe('shipping utils', () => {
  describe('calculateShippingFee', () => {
    it('宅配未達免運門檻收取 120 元基本運費', () => {
      const result = calculateShippingFee({
        deliveryMethod: 'home',
        subtotal: 1000,
        address: '台北市中正區忠孝東路 1 號'
      });
      expect(result.baseFee).toBe(120);
      expect(result.totalFee).toBe(120);
      expect(result.isFreeShipping).toBe(false);
    });

    it('超商取貨未達免運門檻收取 60 元基本運費', () => {
      const result = calculateShippingFee({
        deliveryMethod: 'cvs',
        subtotal: 1000,
        address: '台北市中正區忠孝東路 1 號'
      });
      expect(result.baseFee).toBe(60);
      expect(result.totalFee).toBe(60);
    });

    it('商品小計達 1,500 元（邊界值），宅配免基本運費', () => {
      const result = calculateShippingFee({
        deliveryMethod: 'home',
        subtotal: 1500,
        address: '台北市中正區忠孝東路 1 號'
      });
      expect(result.isFreeShipping).toBe(true);
      expect(result.baseFee).toBe(0);
      expect(result.totalFee).toBe(0);
    });

    it('商品小計達 1,500 元，超商取貨也免基本運費', () => {
      const result = calculateShippingFee({
        deliveryMethod: 'cvs',
        subtotal: 2000,
        address: '台北市中正區忠孝東路 1 號'
      });
      expect(result.isFreeShipping).toBe(true);
      expect(result.baseFee).toBe(0);
      expect(result.totalFee).toBe(0);
    });

    it('商品小計未達 1,499 元，不適用免運', () => {
      const result = calculateShippingFee({
        deliveryMethod: 'home',
        subtotal: 1499,
        address: '台北市中正區忠孝東路 1 號'
      });
      expect(result.isFreeShipping).toBe(false);
      expect(result.baseFee).toBe(120);
    });

    it('偏遠地區加收 200 元，不受免運門檻影響', () => {
      const result = calculateShippingFee({
        deliveryMethod: 'home',
        subtotal: 2000,
        address: '澎湖縣馬公市中正路 1 號'
      });
      expect(result.isFreeShipping).toBe(true);
      expect(result.isRemote).toBe(true);
      expect(result.baseFee).toBe(0);
      expect(result.remoteFee).toBe(200);
      expect(result.totalFee).toBe(200);
    });

    it('當日急件加收 250 元', () => {
      const result = calculateShippingFee({
        deliveryMethod: 'home',
        subtotal: 1000,
        address: '台北市中正區忠孝東路 1 號',
        isRush: true
      });
      expect(result.rushFee).toBe(250);
      expect(result.totalFee).toBe(120 + 250);
    });

    it('偏遠 + 急件 + 未達免運：基本運費 + 偏遠 + 急件 全部加總', () => {
      const result = calculateShippingFee({
        deliveryMethod: 'cvs',
        subtotal: 500,
        address: '金門縣金城鎮民生路 1 號',
        isRush: true
      });
      expect(result.baseFee).toBe(60);
      expect(result.remoteFee).toBe(200);
      expect(result.rushFee).toBe(250);
      expect(result.totalFee).toBe(60 + 200 + 250);
    });

    it('偏遠 + 急件 + 已達免運：基本運費免除，偏遠與急件仍收取', () => {
      const result = calculateShippingFee({
        deliveryMethod: 'home',
        subtotal: 3000,
        address: '連江縣南竿鄉介壽村 1 號',
        isRush: true
      });
      expect(result.isFreeShipping).toBe(true);
      expect(result.baseFee).toBe(0);
      expect(result.remoteFee).toBe(200);
      expect(result.rushFee).toBe(250);
      expect(result.totalFee).toBe(450);
    });

    it('deliveryMethod 非 home/cvs 時丟出錯誤', () => {
      expect(() => calculateShippingFee({
        deliveryMethod: 'drone',
        subtotal: 1000,
        address: '台北市中正區忠孝東路 1 號'
      })).toThrow();
    });
  });

  describe('isRemoteArea', () => {
    it('地址含偏遠關鍵字時回傳 true', () => {
      expect(isRemoteArea('澎湖縣馬公市中正路 1 號')).toBe(true);
      expect(isRemoteArea('南投縣仁愛鄉廬山里 1 號')).toBe(true);
    });

    it('一般地址回傳 false', () => {
      expect(isRemoteArea('台北市中正區忠孝東路 1 號')).toBe(false);
    });

    it('空地址回傳 false', () => {
      expect(isRemoteArea('')).toBe(false);
      expect(isRemoteArea(undefined)).toBe(false);
    });
  });

  it('SHIPPING_CONFIG 常數符合規則表定義', () => {
    expect(SHIPPING_CONFIG.HOME_DELIVERY_FEE).toBe(120);
    expect(SHIPPING_CONFIG.CVS_PICKUP_FEE).toBe(60);
    expect(SHIPPING_CONFIG.FREE_SHIPPING_THRESHOLD).toBe(1500);
    expect(SHIPPING_CONFIG.REMOTE_AREA_FEE).toBe(200);
    expect(SHIPPING_CONFIG.RUSH_FEE).toBe(250);
  });
});
