(() => {
  "use strict";

  const state = {
    products: [],
    cart: [],
    user: null
  };

  const $ = (id) => document.getElementById(id);

  function formatPoints(value) {
    return `${Number(value || 0).toLocaleString("ar-DZ")} نقطة`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /* =========================
     API
  ========================= */

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    let data = {};

    try {
      data = await response.json();
    } catch {
      data = {};
    }

    return {
      response,
      data
    };
  }

  /* =========================
     PRODUCTS
  ========================= */

  async function loadProducts() {
    const grid = $("productsGrid");

    if (grid) {
      grid.innerHTML =
        `<p style="color:#9ca3af">جاري تحميل المنتجات...</p>`;
    }

    try {
      const { response, data } =
        await api("/api/products", {
          method: "GET"
        });

      if (!response.ok) {
        throw new Error(
          data.error || "PRODUCTS_UNAVAILABLE"
        );
      }

      state.products =
        Array.isArray(data.products)
          ? data.products
          : [];

      renderProducts();

    } catch (error) {
      console.error("Products:", error);

      if (grid) {
        grid.innerHTML = `
          <p style="color:#ef4444">
            تعذر تحميل المنتجات.
          </p>
        `;
      }
    }
  }

  function renderProducts(list = state.products) {
    const grid = $("productsGrid");

    if (!grid) return;

    if (!list.length) {
      grid.innerHTML = `
        <p style="color:#9ca3af">
          لا توجد منتجات متاحة حالياً.
        </p>
      `;
      return;
    }

    grid.innerHTML = list.map((product) => {
      const image = product.image_url
        ? `
          <img
            src="${escapeHtml(product.image_url)}"
            alt="${escapeHtml(product.name)}"
            style="
              width:100%;
              height:100%;
              object-fit:cover;
              border-radius:14px;
            "
          >
        `
        : `
          <span style="font-size:42px">
            🎁
          </span>
        `;

      return `
        <article class="card">
          <div
            class="product-img"
            style="
              display:flex;
              align-items:center;
              justify-content:center;
              overflow:hidden;
            ">
            ${image}
          </div>

          <h3>
            ${escapeHtml(product.name)}
          </h3>

          ${
            product.diamonds != null
              ? `
                <div style="
                  color:#9ca3af;
                  margin-bottom:6px;
                ">
                  💎 ${Number(product.diamonds).toLocaleString("ar-DZ")}
                </div>
              `
              : ""
          }

          <div class="price">
            ${formatPoints(product.price_points)}
          </div>

          <button
            class="add"
            type="button"
            data-add="${escapeHtml(product.id)}">
            أضف إلى السلة
          </button>
        </article>
      `;
    }).join("");

    grid
      .querySelectorAll("[data-add]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          addToCart(button.dataset.add);
        });
      });
  }

  /* =========================
     CART
  ========================= */

  function addToCart(productId) {
    const product = state.products.find(
      (item) => String(item.id) === String(productId)
    );

    if (!product) {
      alert("المنتج غير موجود.");
      return;
    }

    state.cart.push(product);

    saveCart();
    updateCart();

    alert(
      `تمت إضافة ${product.name} إلى السلة ✅`
    );
  }

  function removeFromCart(index) {
    state.cart.splice(index, 1);

    saveCart();
    updateCart();
  }

  function saveCart() {
    localStorage.setItem(
      "cha9fa_cart",
      JSON.stringify(state.cart)
    );
  }

  function loadCart() {
    try {
      const saved =
        JSON.parse(
          localStorage.getItem("cha9fa_cart") || "[]"
        );

      state.cart =
        Array.isArray(saved)
          ? saved
          : [];
    } catch {
      state.cart = [];
    }
  }

  function updateCart() {
    const count = $("cartCount");
    const items = $("cartItems");
    const total = $("cartTotal");

    if (count) {
      count.textContent =
        state.cart.length;
    }

    if (items) {
      if (!state.cart.length) {
        items.innerHTML = `
          <p style="color:#9ca3af">
            السلة فارغة.
          </p>
        `;
      } else {
        items.innerHTML =
          state.cart.map((product, index) => `
            <div class="cart-item">
              <span>
                ${escapeHtml(product.name)}
              </span>

              <span>
                ${formatPoints(product.price_points)}

                <button
                  type="button"
                  data-remove="${index}">
                  ✕
                </button>
              </span>
            </div>
          `).join("");

        items
          .querySelectorAll("[data-remove]")
          .forEach((button) => {
            button.addEventListener(
              "click",
              () => {
                removeFromCart(
                  Number(button.dataset.remove)
                );
              }
            );
          });
      }
    }

    if (total) {
      const amount =
        state.cart.reduce(
          (sum, product) =>
            sum +
            Number(product.price_points || 0),
          0
        );

      total.textContent =
        formatPoints(amount);
    }
  }

  function openCart() {
    $("cartPanel")?.classList.add("open");
    $("overlay")?.classList.add("show");
  }

  function closeCart() {
    $("cartPanel")?.classList.remove("open");
    $("overlay")?.classList.remove("show");
  }

  /* =========================
     AUTH / USER
  ========================= */

  async function loadUser() {
    try {
      const { response, data } =
        await api("/api/me", {
          method: "GET"
        });

      if (!response.ok) {
        return;
      }

      if (data.authenticated) {
        state.user = data.user;
      } else {
        state.user = null;
      }

      renderAuth();

    } catch (error) {
      console.error(
        "User:",
        error
      );
    }
  }

  function renderAuth() {
    const header =
      document.querySelector(".header");

    if (!header) return;

    let box =
      $("kickAuthBox");

    if (!box) {
      box =
        document.createElement("div");

      box.id =
        "kickAuthBox";

      box.style.cssText = `
        display:flex;
        align-items:center;
        gap:8px;
        margin-inline:auto 12px;
        flex-wrap:wrap;
      `;

      header.insertBefore(
        box,
        $("cartBtn") || null
      );
    }

    if (state.user) {
      box.innerHTML = `
        <span
          style="
            padding:8px 12px;
            border-radius:999px;
            background:#17220f;
            color:#8cff4d;
            font-weight:700;
          ">
          ${escapeHtml(state.user.kick_username)}
          —
          ${formatPoints(state.user.points)}
        </span>

        <button
          id="logoutBtn"
          class="primary"
          type="button">
          تسجيل الخروج
        </button>
      `;

      $("logoutBtn")
        ?.addEventListener(
          "click",
          logout
        );

    } else {
      box.innerHTML = `
        <a
          href="/auth/kick"
          class="primary"
          style="
            text-decoration:none;
            display:inline-block;
          ">
          تسجيل الدخول بـ Kick
        </a>
      `;
    }
  }

  async function logout() {
    try {
      await api("/auth/logout", {
        method: "POST"
      });
    } catch (error) {
      console.error(
        "Logout:",
        error
      );
    }

    state.user = null;

    renderAuth();

    alert(
      "تم تسجيل الخروج."
    );
  }

  /* =========================
     ORDER
  ========================= */

  async function checkout() {
    if (!state.cart.length) {
      alert("السلة فارغة.");
      return;
    }

    if (!state.user) {
      window.location.href =
        "/auth/kick";
      return;
    }

    const playerName =
      prompt(
        "أدخل اسم اللاعب:"
      );

    if (
      playerName === null ||
      playerName.trim().length < 2
    ) {
      alert(
        "اسم اللاعب مطلوب."
      );
      return;
    }

    const country =
      prompt(
        "أدخل الدولة:"
      );

    if (
      country === null ||
      country.trim().length < 2
    ) {
      alert(
        "الدولة مطلوبة."
      );
      return;
    }

    const gameId =
      prompt(
        "أدخل ID اللعبة:"
      );

    if (
      gameId === null ||
      gameId.trim().length < 2
    ) {
      alert(
        "ID اللعبة مطلوب."
      );
      return;
    }

    const total =
      state.cart.reduce(
        (sum, product) =>
          sum +
          Number(product.price_points || 0),
        0
      );

    const confirmed =
      confirm(
        `سيتم خصم ${formatPoints(total)}.\n\n` +
        `اسم اللاعب: ${playerName.trim()}\n` +
        `الدولة: ${country.trim()}\n` +
        `ID اللعبة: ${gameId.trim()}\n\n` +
        `هل تريد المتابعة؟`
      );

    if (!confirmed) {
      return;
    }

    const productsToOrder =
      [...state.cart];

    let completed = 0;

    for (
      const product of productsToOrder
    ) {
      try {
        const { response, data } =
          await api("/api/orders", {
            method: "POST",

            body: JSON.stringify({
              productId:
                String(product.id),

              playerName:
                playerName.trim(),

              country:
                country.trim(),

              gameId:
                gameId.trim()
            })
          });

        if (!response.ok) {
          if (
            data.error ===
            "INSUFFICIENT_POINTS"
          ) {
            alert(
              "رصيد النقاط غير كافٍ لإتمام الطلب."
            );
          } else if (
            data.error ===
            "PRODUCT_NOT_FOUND"
          ) {
            alert(
              `المنتج غير موجود: ${product.name}`
            );
          } else if (
            data.error ===
            "AUTH_REQUIRED"
          ) {
            alert(
              "انتهت جلسة تسجيل الدخول. سجّل الدخول مرة أخرى."
            );

            window.location.href =
              "/auth/kick";

          } else {
            alert(
              "حدث خطأ أثناء إنشاء الطلب."
            );
          }

          break;
        }

        completed++;

      } catch (error) {
        console.error(
          "Order:",
          error
        );

        alert(
          "تعذر الاتصال بالسيرفر."
        );

        break;
      }
    }

    if (completed === productsToOrder.length) {
      state.cart = [];

      saveCart();
      updateCart();
      closeCart();

      await loadUser();

      alert(
        "تم إنشاء الطلب بنجاح ✅"
      );
    } else if (completed > 0) {
      state.cart =
        state.cart.slice(completed);

      saveCart();
      updateCart();

      await loadUser();

      alert(
        `تم إنشاء ${completed} طلب، ` +
        `لكن تعذر إكمال باقي الطلبات.`
      );
    }
  }

  /* =========================
     SEARCH
  ========================= */

  function setupSearch() {
    const search =
      $("search");

    if (!search) return;

    search.addEventListener(
      "input",
      (event) => {
        const query =
          event.target.value
            .trim()
            .toLowerCase();

        const filtered =
          state.products.filter(
            (product) =>
              String(product.name || "")
                .toLowerCase()
                .includes(query)
          );

        renderProducts(filtered);
      }
    );
  }

  /* =========================
     INIT
  ========================= */

  async function init() {
    loadCart();
    updateCart();

    $("cartBtn")
      ?.addEventListener(
        "click",
        openCart
      );

    $("closeCart")
      ?.addEventListener(
        "click",
        closeCart
      );

    $("overlay")
      ?.addEventListener(
        "click",
        closeCart
      );

    $("checkout")
      ?.addEventListener(
        "click",
        checkout
      );

    setupSearch();

    await Promise.all([
      loadProducts(),
      loadUser()
    ]);
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init
    );
  } else {
    init();
  }

})();
