// ================================
// SUPABASE
// ================================

const SUPABASE_URL = "https://dopjzxjhyrgnvrpuboiv.supabase.co";
const SUPABASE_KEY = "sb_publishable_OqmrAdrqA2RnU2mCvJhaOQ_38nZsNlm";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

// ================================
// المنتجات
// ================================

const products = [
  {
    id: 1,
    name: "100 جواهر",
    price: 300,
    icon: "images/diamond.png"
  },
  {
    id: 2,
    name: "300 جواهر",
    price: 900,
    icon: "images/diamond.png"
  },
  {
    id: 3,
    name: "500 جواهر",
    price: 1500,
    icon: "images/diamond.png"
  },
  {
    id: 4,
    name: "1000 جواهر",
    price: 3000,
    icon: "images/diamond.png"
  }
];

let cart = [];
let user = null;
let balance = 0;

// ================================
// عناصر الصفحة
// ================================

const grid = document.getElementById("productsGrid");
const search = document.getElementById("search");

// ================================
// إنشاء حساب ضيف
// ================================

async function initGuest() {
  try {
    const { data: sessionData } =
      await supabaseClient.auth.getSession();

    if (sessionData && sessionData.session) {
      user = sessionData.session.user;
    } else {
      const { data, error } =
        await supabaseClient.auth.signInAnonymously();

      if (error) {
        console.error("Guest login error:", error);
        return;
      }

      user = data.user;
    }

    await loadBalance();

  } catch (error) {
    console.error("Initialization error:", error);
  }
}

// ================================
// جلب الرصيد الحقيقي
// ================================

async function loadBalance() {
  if (!user) return;

  try {
    const { data, error } = await supabaseClient
      .from("balances")
      .select("points")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Balance error:", error);
      balance = 0;
    } else {
      balance = data ? Number(data.points) : 0;
    }

    updateBalanceUI();
    render();
    updateCart();

  } catch (error) {
    console.error("Load balance error:", error);
  }
}

// ================================
// عرض الرصيد
// ================================

function updateBalanceUI() {

  const balanceElements = [
    document.getElementById("balance"),
    document.getElementById("pointsBalance"),
    document.getElementById("userPoints")
  ];

  balanceElements.forEach(element => {
    if (element) {
      element.textContent =
        balance.toLocaleString() + " نقطة";
    }
  });
}

// ================================
// عرض المنتجات
// ================================

function render(list = products) {

  if (!grid) return;

  grid.innerHTML = list.map(p => {

    const canBuy = balance >= p.price;

    return `
      <article class="card">

        <div class="product-img">
          <img src="${p.icon}" alt="${p.name}">
        </div>

        <h3>${p.name}</h3>

        <div class="price">
          ${p.price.toLocaleString()} نقطة
        </div>

        <button
          class="add ${canBuy ? "available" : "disabled"}"
          onclick="addToCart(${p.id})"
          ${canBuy ? "" : "disabled"}
        >
          ${canBuy ? "أضف إلى السلة" : "نقاط غير كافية"}
        </button>

      </article>
    `;

  }).join("");
}

// ================================
// إضافة للسلة
// ================================

function addToCart(id) {

  const product = products.find(p => p.id === id);

  if (!product) return;

  if (balance < product.price) {
    alert(
      `رصيدك غير كافٍ.\n\nرصيدك: ${balance.toLocaleString()} نقطة\nالسعر: ${product.price.toLocaleString()} نقطة`
    );
    return;
  }

  cart.push(product);

  updateCart();
}

// ================================
// تحديث السلة
// ================================

function updateCart() {

  const cartCount =
    document.getElementById("cartCount");

  const cartItems =
    document.getElementById("cartItems");

  const cartTotal =
    document.getElementById("cartTotal");

  if (cartCount) {
    cartCount.textContent = cart.length;
  }

  if (cartItems) {

    cartItems.innerHTML =
      cart.length

        ? cart.map((p, i) => `
            <div class="cart-item">

              <span>
                ${p.name}
              </span>

              <span>
                ${p.price.toLocaleString()} نقطة

                <button
                  onclick="removeItem(${i})"
                >
                  ✕
                </button>

              </span>

            </div>
          `).join("")

        : "<p style='color:#9ca3af'>السلة فارغة.</p>";
  }

  const total =
    cart.reduce(
      (sum, p) => sum + p.price,
      0
    );

  if (cartTotal) {
    cartTotal.textContent =
      total.toLocaleString() + " نقطة";
  }

  updateCheckoutButton();
}

// ================================
// حذف منتج
// ================================

function removeItem(i) {

  cart.splice(i, 1);

  updateCart();
}

// ================================
// فتح السلة
// ================================

function openCart() {

  const panel =
    document.getElementById("cartPanel");

  const overlay =
    document.getElementById("overlay");

  if (panel) {
    panel.classList.add("open");
  }

  if (overlay) {
    overlay.classList.add("show");
  }
}

// ================================
// إغلاق السلة
// ================================

function closeCart() {

  const panel =
    document.getElementById("cartPanel");

  const overlay =
    document.getElementById("overlay");

  if (panel) {
    panel.classList.remove("open");
  }

  if (overlay) {
    overlay.classList.remove("show");
  }
}

// ================================
// زر السلة
// ================================

const cartBtn =
  document.getElementById("cartBtn");

const closeCartBtn =
  document.getElementById("closeCart");

const overlay =
  document.getElementById("overlay");

if (cartBtn) {
  cartBtn.onclick = openCart;
}

if (closeCartBtn) {
  closeCartBtn.onclick = closeCart;
}

if (overlay) {
  overlay.onclick = closeCart;
}

// ================================
// زر الدفع
// ================================

function updateCheckoutButton() {

  const checkout =
    document.getElementById("checkout");

  if (!checkout) return;

  const total =
    cart.reduce(
      (sum, p) => sum + p.price,
      0
    );

  if (cart.length > 0 && balance >= total) {

    checkout.disabled = false;

    checkout.style.background = "#22c55e";
    checkout.style.cursor = "pointer";
    checkout.style.opacity = "1";

    checkout.textContent = "إتمام الطلب";

  } else {

    checkout.disabled = true;

    checkout.style.background = "#374151";
    checkout.style.cursor = "not-allowed";
    checkout.style.opacity = "0.6";

    checkout.textContent = "رصيد غير كافٍ";
  }
}

// ================================
// تنفيذ الطلب
// ================================

async function checkout() {

  if (!user) {
    alert("لم يتم تسجيل حساب الضيف.");
    return;
  }

  if (cart.length === 0) {
    alert("السلة فارغة.");
    return;
  }

  const total =
    cart.reduce(
      (sum, p) => sum + p.price,
      0
    );

  if (balance < total) {
    alert("رصيدك غير كافٍ.");
    return;
  }

  const checkoutButton =
    document.getElementById("checkout");

  if (checkoutButton) {
    checkoutButton.disabled = true;
    checkoutButton.textContent = "جارٍ التنفيذ...";
  }

  try {

    const newBalance =
      balance - total;

    const { error } =
      await supabaseClient
        .from("balances")
        .update({
          points: newBalance,
          updated_at: new Date().toISOString()
        })
        .eq("user_id", user.id);

    if (error) {
      console.error(error);

      alert(
        "حدث خطأ أثناء تحديث الرصيد."
      );

      updateCheckoutButton();
      return;
    }

    balance = newBalance;

    cart = [];

    updateBalanceUI();
    updateCart();
    render();

    alert(
      "تم إتمام الطلب بنجاح ✅\n\n" +
      "تم خصم " +
      total.toLocaleString() +
      " نقطة من رصيدك."
    );

  } catch (error) {

    console.error(error);

    alert(
      "حدث خطأ غير متوقع."
    );

    updateCheckoutButton();
  }
}

// ================================
// زر إتمام الطلب
// ================================

const checkoutButton =
  document.getElementById("checkout");

if (checkoutButton) {
  checkoutButton.onclick = checkout;
}

// ================================
// البحث
// ================================

if (search) {

  search.oninput = () => {

    const q =
      search.value.trim();

    render(
      products.filter(p =>
        p.name.includes(q)
      )
    );
  };
}

// ================================
// تشغيل الموقع
// ================================

render();
updateCart();
initGuest();
