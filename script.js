// ==========================================
// SUPABASE
// ==========================================

const SUPABASE_URL = "https://dopjzxjhyrgnvrpuboiv.supabase.co";

const SUPABASE_KEY =
  "sb_publishable_OqmrAdrqA2RnU2mCvJhaOQ_38nZsNlm";

const { createClient } = supabase;

const db = createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);


// ==========================================
// PRODUCTS
// ==========================================

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


// ==========================================
// VARIABLES
// ==========================================

let cart = [];

let user = null;

let userPoints = 0;


const grid = document.getElementById("productsGrid");
const search = document.getElementById("search");


// ==========================================
// إنشاء حساب ضيف / استرجاع الجلسة
// ==========================================

async function initGuest() {

  try {

    // أولاً نحاول الحصول على الجلسة الحالية
    const {
      data: {
        session
      }
    } = await db.auth.getSession();


    if (session) {

      user = session.user;

      console.log("Guest session موجودة:", user.id);

    } else {

      // إنشاء حساب ضيف جديد
      const {
        data,
        error
      } = await db.auth.signInAnonymously();


      if (error) {
        console.error("خطأ إنشاء حساب الضيف:", error);
        return;
      }


      user = data.user;

      console.log("تم إنشاء حساب ضيف:", user.id);

    }


    // تحميل الرصيد
    await loadBalance();


    // تحديث المنتجات
    render();


  } catch (error) {

    console.error("خطأ:", error);

  }

}


// ==========================================
// جلب رصيد النقاط من balances
// ==========================================

async function loadBalance() {

  if (!user) return;


  try {

    const {
      data,
      error
    } = await db
      .from("balances")
      .select("points")
      .eq("user_id", user.id)
      .maybeSingle();


    if (error) {

      console.error("خطأ قراءة الرصيد:", error);

      userPoints = 0;

      updateBalanceDisplay();

      return;
    }


    if (data) {

      userPoints = Number(data.points) || 0;

    } else {

      // إذا لم يوجد سجل للضيف
      // ننشئ له رصيد 0

      const {
        error: insertError
      } = await db
        .from("balances")
        .insert({
          user_id: user.id,
          points: 0
        });


      if (insertError) {

        console.error(
          "خطأ إنشاء رصيد الضيف:",
          insertError
        );

      }

      userPoints = 0;
    }


    updateBalanceDisplay();


  } catch (error) {

    console.error(error);

  }

}


// ==========================================
// عرض الرصيد
// ==========================================

function updateBalanceDisplay() {

  // إذا كان لديك عنصر باسم userPoints
  const balanceElement =
    document.getElementById("userPoints");

  if (balanceElement) {

    balanceElement.textContent =
      userPoints.toLocaleString() + " نقطة";

  }

}


// ==========================================
// عرض المنتجات
// ==========================================

function render(list = products) {

  if (!grid) return;


  grid.innerHTML = list.map(p => {

    // هل لديه نقاط كافية؟
    const canBuy = userPoints >= p.price;


    return `
      <article class="card">

        <div class="product-img">
          <img
            src="${p.icon}"
            alt="${p.name}"
          >
        </div>


        <h3>
          ${p.name}
        </h3>


        <div class="price">
          ${p.price.toLocaleString()} نقطة
        </div>


        <button
          class="add ${canBuy ? "available" : "disabled"}"
          ${canBuy ? "" : "disabled"}
          onclick="addToCart(${p.id})"
        >
          ${
            canBuy
              ? "أضف إلى السلة"
              : "نقاط غير كافية"
          }
        </button>

      </article>
    `;

  }).join("");

}


// ==========================================
// إضافة إلى السلة
// ==========================================

function addToCart(id) {

  const product =
    products.find(p => p.id === id);


  if (!product) return;


  // التأكد من الرصيد
  if (userPoints < product.price) {

    alert(
      `رصيدك غير كافٍ.\n\nرصيدك الحالي: ${userPoints.toLocaleString()} نقطة\nالسعر: ${product.price.toLocaleString()} نقطة`
    );

    return;
  }


  cart.push(product);

  updateCart();

}


// ==========================================
// تحديث السلة
// ==========================================

function updateCart() {

  const cartCount =
    document.getElementById("cartCount");

  const cartItems =
    document.getElementById("cartItems");

  const cartTotal =
    document.getElementById("cartTotal");


  if (cartCount) {

    cartCount.textContent =
      cart.length;

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

                ${p.price.toLocaleString()}
                نقطة

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

}


// ==========================================
// حذف منتج من السلة
// ==========================================

function removeItem(i) {

  cart.splice(i, 1);

  updateCart();

}


// ==========================================
// فتح السلة
// ==========================================

function openCart() {

  document
    .getElementById("cartPanel")
    .classList.add("open");

  document
    .getElementById("overlay")
    .classList.add("show");

}


// ==========================================
// إغلاق السلة
// ==========================================

function closeCart() {

  document
    .getElementById("cartPanel")
    .classList.remove("open");

  document
    .getElementById("overlay")
    .classList.remove("show");

}


// ==========================================
// أزرار السلة
// ==========================================

document
  .getElementById("cartBtn")
  .onclick = openCart;


document
  .getElementById("closeCart")
  .onclick = closeCart;


document
  .getElementById("overlay")
  .onclick = closeCart;


// ==========================================
// البحث
// ==========================================

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


// ==========================================
// إتمام الطلب
// ==========================================

document
  .getElementById("checkout")
  .onclick = async () => {


    if (!user) {

      alert("لم يتم تسجيل حساب الضيف بعد.");

      return;

    }


    if (!cart.length) {

      alert("السلة فارغة.");

      return;

    }


    const total =
      cart.reduce(
        (sum, p) => sum + p.price,
        0
      );


    // التأكد من الرصيد مرة أخرى
    await loadBalance();


    if (userPoints < total) {

      alert(
        `رصيدك غير كافٍ.\n\nرصيدك: ${userPoints.toLocaleString()} نقطة\nالمطلوب: ${total.toLocaleString()} نقطة`
      );

      return;

    }


    alert(
      "الرصيد كافٍ لإتمام الطلب."
    );

  };


// ==========================================
// تشغيل الموقع
// ==========================================

async function startApp() {

  // إظهار المنتجات مبدئياً
  render();

  updateCart();

  // تشغيل حساب الضيف
  await initGuest();

}


// تشغيل التطبيق
startApp();
