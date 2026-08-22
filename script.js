// ===============================
// SUPABASE
// ===============================

const SUPABASE_URL = "https://dopjzxjhyrgnvrpuboiv.supabase.co";

const SUPABASE_KEY =
  "sb_publishable_OqmrAdrqA2RnU2mCvJhaOQ_38nZsNlm";

const { createClient } = supabase;

const supabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);


// ===============================
// PRODUCTS
// ===============================

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


// ===============================
// VARIABLES
// ===============================

let cart = [];
let currentUser = null;
let userPoints = 0;


// ===============================
// ELEMENTS
// ===============================

const grid = document.getElementById("productsGrid");
const search = document.getElementById("search");


// ===============================
// AUTH
// ===============================

async function initAuth() {

  try {

    // محاولة الحصول على جلسة موجودة
    const {
      data: {
        session
      }
    } = await supabaseClient.auth.getSession();


    if (session && session.user) {

      currentUser = session.user;

      await loadBalance();

      return;
    }


    // إنشاء حساب ضيف جديد
    const {
      data,
      error
    } = await supabaseClient.auth.signInAnonymously();


    if (error) {
      console.error("خطأ في تسجيل دخول الضيف:", error);

      showUserMessage(
        "تعذر تسجيل الدخول كضيف"
      );

      return;
    }


    if (data && data.user) {

      currentUser = data.user;

      await loadBalance();
    }

  } catch (error) {

    console.error(error);

    showUserMessage(
      "حدث خطأ أثناء الاتصال بالحساب"
    );
  }
}


// ===============================
// LOAD BALANCE
// ===============================

async function loadBalance() {

  if (!currentUser) {
    return;
  }


  try {

    const {
      data,
      error
    } = await supabaseClient
      .from("balances")
      .select("points")
      .eq("user_id", currentUser.id)
      .maybeSingle();


    if (error) {

      console.error(
        "خطأ في قراءة الرصيد:",
        error
      );

      userPoints = 0;

      render();

      return;
    }


    if (data) {

      userPoints = Number(data.points) || 0;

    } else {

      // إذا لم يوجد سجل للضيف
      // ننشئ له رصيدًا صفرًا

      const {
        error: insertError
      } = await supabaseClient
        .from("balances")
        .insert({
          user_id: currentUser.id,
          points: 0
        });


      if (insertError) {

        console.error(
          "خطأ في إنشاء الرصيد:",
          insertError
        );

      }

      userPoints = 0;
    }


    updateBalanceUI();

    render();


  } catch (error) {

    console.error(error);

    userPoints = 0;

    updateBalanceUI();

    render();
  }
}


// ===============================
// BALANCE UI
// ===============================

function updateBalanceUI() {

  const balanceElements = [

    document.getElementById("userPoints"),

    document.getElementById("pointsBalance"),

    document.getElementById("balance"),

    document.getElementById("points")

  ];


  balanceElements.forEach(element => {

    if (element) {

      element.textContent =
        userPoints.toLocaleString() + " نقطة";

    }

  });
}


// ===============================
// RENDER PRODUCTS
// ===============================

function render(list = products) {

  if (!grid) {
    return;
  }


  grid.innerHTML = list.map(p => {

    const canBuy =
      userPoints >= p.price;


    return `
      <article class="card">

        <div class="product-img">
          <img
            src="${p.icon}"
            alt="${p.name}"
          >
        </div>

        <h3>${p.name}</h3>

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


// ===============================
// ADD TO CART
// ===============================

function addToCart(id) {

  const product =
    products.find(p => p.id === id);


  if (!product) {
    return;
  }


  // التأكد من الرصيد قبل الإضافة
  if (userPoints < product.price) {

    alert(
      `رصيدك غير كافٍ.\n\nرصيدك: ${userPoints.toLocaleString()} نقطة\nالمطلوب: ${product.price.toLocaleString()} نقطة`
    );

    return;
  }


  cart.push(product);

  updateCart();
}


// ===============================
// UPDATE CART
// ===============================

function updateCart() {

  const cartCount =
    document.getElementById("cartCount");

  if (cartCount) {

    cartCount.textContent =
      cart.length;
  }


  const cartItems =
    document.getElementById("cartItems");


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


  const cartTotal =
    document.getElementById("cartTotal");


  if (cartTotal) {

    cartTotal.textContent =
      total.toLocaleString() + " نقطة";
  }
}


// ===============================
// REMOVE ITEM
// ===============================

function removeItem(i) {

  cart.splice(i, 1);

  updateCart();
}


// ===============================
// CART OPEN / CLOSE
// ===============================

function openCart() {

  document
    .getElementById("cartPanel")
    ?.classList.add("open");

  document
    .getElementById("overlay")
    ?.classList.add("show");
}


function closeCart() {

  document
    .getElementById("cartPanel")
    ?.classList.remove("open");

  document
    .getElementById("overlay")
    ?.classList.remove("show");
}


document
  .getElementById("cartBtn")
  ?.addEventListener(
    "click",
    openCart
  );


document
  .getElementById("closeCart")
  ?.addEventListener(
    "click",
    closeCart
  );


document
  .getElementById("overlay")
  ?.addEventListener(
    "click",
    closeCart
  );


// ===============================
// CHECKOUT
// ===============================

document
  .getElementById("checkout")
  ?.addEventListener(
    "click",
    async () => {

      if (!currentUser) {

        alert(
          "لم يتم تسجيل الدخول بعد."
        );

        return;
      }


      if (!cart.length) {

        alert(
          "السلة فارغة."
        );

        return;
      }


      const total =
        cart.reduce(
          (sum, p) => sum + p.price,
          0
        );


      if (userPoints < total) {

        alert(
          `رصيدك غير كافٍ.\n\nرصيدك: ${userPoints.toLocaleString()} نقطة\nالمطلوب: ${total.toLocaleString()} نقطة`
        );

        return;
      }


      alert(
        "الرصيد كافٍ. الخطوة التالية ستكون تنفيذ الخصم الحقيقي من Supabase."
      );

    }
  );


// ===============================
// SEARCH
// ===============================

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


// ===============================
// AUTH STATE CHANGES
// ===============================

supabaseClient.auth
  .onAuthStateChange(
    async (event, session) => {

      if (session && session.user) {

        currentUser =
          session.user;

        await loadBalance();

      }

    }
  );


// ===============================
// MESSAGE
// ===============================

function showUserMessage(message) {

  console.log(message);

  const element =
    document.getElementById(
      "userMessage"
    );


  if (element) {

    element.textContent =
      message;
  }
}


// ===============================
// START
// ===============================

render();

updateCart();

initAuth();
