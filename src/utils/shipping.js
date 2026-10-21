const SHIPPING_CONFIG = {
  HOME_DELIVERY_FEE: 120,
  CVS_PICKUP_FEE: 60,
  FREE_SHIPPING_THRESHOLD: 1500,
  REMOTE_AREA_FEE: 200,
  RUSH_FEE: 250,
};

// 偏遠地區關鍵字清單（離島、山地鄉），依實際配送商偏遠地區名單擴充，不求窮盡
const REMOTE_AREA_KEYWORDS = [
  '金門', '連江', '馬祖', '澎湖',
  '綠島', '蘭嶼', '琉球嶼', '小琉球',
  '烏來', '復興區', '尖石', '五峰', '卓蘭',
  '仁愛鄉', '信義鄉', '魚池鄉', '和平區',
];

const BASE_FEE_BY_DELIVERY_METHOD = {
  home: SHIPPING_CONFIG.HOME_DELIVERY_FEE,
  cvs: SHIPPING_CONFIG.CVS_PICKUP_FEE,
};

function isRemoteArea(address) {
  if (!address) return false;
  return REMOTE_AREA_KEYWORDS.some((keyword) => address.includes(keyword));
}

function calculateShippingFee({ deliveryMethod, subtotal, address, isRush = false }) {
  const baseFee = BASE_FEE_BY_DELIVERY_METHOD[deliveryMethod];
  if (baseFee === undefined) {
    throw new Error(`未知的配送方式: ${deliveryMethod}`);
  }

  const isFreeShipping = subtotal >= SHIPPING_CONFIG.FREE_SHIPPING_THRESHOLD;
  const remote = isRemoteArea(address);

  const appliedBaseFee = isFreeShipping ? 0 : baseFee;
  const remoteFee = remote ? SHIPPING_CONFIG.REMOTE_AREA_FEE : 0;
  const rushFee = isRush ? SHIPPING_CONFIG.RUSH_FEE : 0;

  return {
    baseFee: appliedBaseFee,
    remoteFee,
    rushFee,
    totalFee: appliedBaseFee + remoteFee + rushFee,
    isFreeShipping,
    isRemote: remote,
  };
}

module.exports = {
  calculateShippingFee,
  isRemoteArea,
  SHIPPING_CONFIG,
  REMOTE_AREA_KEYWORDS,
};
