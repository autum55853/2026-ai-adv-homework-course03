const { createApp, ref, computed, onMounted } = Vue;

// 運費規則預覽用常數，須與後端 src/utils/shipping.js 的 SHIPPING_CONFIG 保持一致
// 正式金額仍以後端 API 回傳為準，此處僅供結帳頁即時顯示
const SHIPPING_CONFIG = {
  HOME_DELIVERY_FEE: 120,
  CVS_PICKUP_FEE: 60,
  FREE_SHIPPING_THRESHOLD: 1500,
  REMOTE_AREA_FEE: 200,
  RUSH_FEE: 250,
};

const REMOTE_AREA_KEYWORDS = [
  '金門', '連江', '馬祖', '澎湖',
  '綠島', '蘭嶼', '琉球嶼', '小琉球',
  '烏來', '復興區', '尖石', '五峰', '卓蘭',
  '仁愛鄉', '信義鄉', '魚池鄉', '和平區',
];

function isRemoteArea(address) {
  if (!address) return false;
  return REMOTE_AREA_KEYWORDS.some(function (keyword) {
    return address.includes(keyword);
  });
}

function calculateShippingFee(deliveryMethod, subtotal, address, isRush) {
  const baseFeeMap = { home: SHIPPING_CONFIG.HOME_DELIVERY_FEE, cvs: SHIPPING_CONFIG.CVS_PICKUP_FEE };
  const baseFee = baseFeeMap[deliveryMethod] || 0;
  const isFreeShipping = subtotal >= SHIPPING_CONFIG.FREE_SHIPPING_THRESHOLD;
  const remote = isRemoteArea(address);

  const appliedBaseFee = isFreeShipping ? 0 : baseFee;
  const remoteFee = remote ? SHIPPING_CONFIG.REMOTE_AREA_FEE : 0;
  const rushFee = isRush ? SHIPPING_CONFIG.RUSH_FEE : 0;

  return {
    baseFee: appliedBaseFee,
    remoteFee: remoteFee,
    rushFee: rushFee,
    totalFee: appliedBaseFee + remoteFee + rushFee,
  };
}

createApp({
  setup() {
    if (!Auth.requireAuth()) return {};

    const loading = ref(true);
    const submitting = ref(false);
    const cartItems = ref([]);
    const form = ref({
      recipientName: '',
      recipientEmail: '',
      recipientAddress: '',
      deliveryMethod: 'home',
      isRush: false
    });
    const errors = ref({});

    const cartTotal = computed(function () {
      return cartItems.value.reduce(function (sum, item) {
        return sum + item.product.price * item.quantity;
      }, 0);
    });

    const shipping = computed(function () {
      return calculateShippingFee(
        form.value.deliveryMethod,
        cartTotal.value,
        form.value.recipientAddress,
        form.value.isRush
      );
    });

    function validate() {
      errors.value = {};
      if (!form.value.recipientName.trim()) errors.value.recipientName = '請輸入收件人姓名';
      if (!form.value.recipientEmail.trim()) {
        errors.value.recipientEmail = '請輸入 Email';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.value.recipientEmail)) {
        errors.value.recipientEmail = 'Email 格式不正確';
      }
      if (!form.value.recipientAddress.trim()) errors.value.recipientAddress = '請輸入收件地址';
      return Object.keys(errors.value).length === 0;
    }

    async function submitOrder() {
      if (!validate() || submitting.value) return;
      submitting.value = true;
      try {
        const res = await apiFetch('/api/orders', {
          method: 'POST',
          body: JSON.stringify(form.value)
        });
        Notification.show('訂單已建立，正在前往付款...', 'success');
        window.location.href = '/ecpay/payment/' + res.data.id;
      } catch (err) {
        Notification.show(err?.data?.message || '訂單建立失敗', 'error');
      } finally {
        submitting.value = false;
      }
    }

    onMounted(async function () {
      try {
        const res = await apiFetch('/api/cart');
        cartItems.value = res.data.items;
        if (cartItems.value.length === 0) {
          window.location.href = '/cart';
          return;
        }
      } catch (e) {
        window.location.href = '/cart';
        return;
      }
      loading.value = false;
    });

    return { loading, submitting, cartItems, form, errors, cartTotal, shipping, submitOrder };
  }
}).mount('#app');
