(() => {
  "use strict";

  const state = {
    products: [
      { id: 1, name: "منتج تجريبي 1", price: 300, icon: "🔥" },
      { id: 2, name: "منتج تجريبي 2", price: 900, icon: "⭐" },
      { id: 3, name: "منتج تجريبي 3", price: 1500, icon: "🎁" },
      { id: 4, name: "منتج تجريبي 4", price: 3000, icon: "💎" }
    ],

    cart: [],
    config: null,
    supabase: null,
    session: null,
    me: null,
    watch: null,
    heartbeat: null
  };

  const $ = id => document.getElementById(id);

  const format = value =>
    `${Number(value || 0).toLocaleString("ar-DZ")} نقطة`;

  const escapeHtml = value =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  /* =========================
     PRODUCTS
  ========================= */

  function renderProducts(list = state.products) {
    const grid = $("productsGrid");
    if (!grid) return;

    grid.innerHTML = list.map(product => `
      <article class="card">
        <div class="product-img">${escapeHtml(product.icon)}</div>

        <h3>${escapeHtml(product.name)}</h3>

        <div class="price">
          ${format(product.price)}
        </div>

        <button
          class="add"
          data-add="${product.id}">
          أضف إلى السلة
        </button>
      </article>
    `).join("");

    grid.querySelectorAll("[data-add]").forEach(button => {
      button.addEventListener("click", () => {
        addToCart(Number(button.dataset.add));
      });
    });
  }

  function addToCart(id) {
    const product = state.products.find(item => item.id === id);

    if (!product) return;

    state.cart.push(product);
    updateCart();

    alert(`تمت إضافة ${product.name} إلى السلة ✅`);
  }

  function removeFromCart(index) {
    state.cart.splice(index, 1);
    updateCart();
  }

  function updateCart() {
    const count = $("cartCount");
    const items = $("cartItems");
    const total = $("cartTotal");

    if (count) {
      count.textContent = state.cart.length;
    }

    if (items) {
      if (!state.cart.length) {
        items.innerHTML =
          `<p style="color:#9ca3af">السلة فارغة.</p>`;
      } else {
        items.innerHTML = state.cart.map((product, index) => `
          <div class="cart-item">
            <span>${escapeHtml(product.name)}</span>

            <span>
              ${format(product.price)}

              <button
                type="button"
                data-remove="${index}">
                ✕
              </button>
            </span>
          </div>
        `).join("");

        items.querySelectorAll("[data-remove]").forEach(button => {
          button.addEventListener("click", () => {
            removeFromCart(Number(button.dataset.remove));
          });
        });
      }
    }

    if (total) {
      const sum = state.cart.reduce(
        (totalPrice, product) => totalPrice + Number(product.price || 0),
        0
      );

      total.textContent = format(sum);
    }

    localStorage.setItem(
      "cha9fa_cart",
      JSON.stringify(state.cart)
    );
  }

  /* =========================
     CART
  ========================= */

  function openCart() {
    $("cartPanel")?.classList.add("open");
    $("overlay")?.classList.add("show");
  }

  function closeCart() {
    $("cartPanel")?.classList.remove("open");
    $("overlay")?.classList.remove("show");
  }

  /* =========================
     SUPABASE
  ========================= */

  async function loadSupabase() {
    if (state.supabase) {
      return state.supabase;
    }

    if (
      !state.config ||
      !state.config.supabaseUrl ||
      !state.config.supabaseAnonKey
    ) {
      throw new Error(
        "إعدادات Supabase غير موجودة في السيرفر."
      );
    }

    if (!window.supabase?.createClient) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");

        script.src =
          "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

        script.onload = resolve;

        script.onerror = () =>
          reject(
            new Error("تعذر تحميل Supabase.")
          );

        document.head.appendChild(script);
      });
    }

    state.supabase = window.supabase.createClient(
      state.config.supabaseUrl,
      state.config.supabaseAnonKey
    );

    return state.supabase;
  }

  /* =========================
     KICK LOGIN
  ========================= */

  function injectAuthUI() {
    const header = document.querySelector(".header");

    if (!header || $("kickAuthBox")) {
      return;
    }

    const box = document.createElement("div");

    box.id = "kickAuthBox";

    box.style.cssText = `
      display:flex;
      align-items:center;
      gap:8px;
      margin-inline:auto 12px;
      font-size:14px;
    `;

    box.innerHTML = `
      <span
        id="pointsBadge"
        style="
          display:none;
          padding:8px 12px;
          border-radius:999px;
          background:#1d2b17;
          color:#8cff4d;
          font-weight:700;
        ">
      </span>

      <button
        id="kickLogin"
        class="primary"
        style="border:0;cursor:pointer">
        تسجيل الدخول بـ Kick
      </button>
    `;

    header.insertBefore(
      box,
      header.lastElementChild
    );

    $("kickLogin")?.addEventListener(
      "click",
      loginKick
    );
  }

  async function loginKick() {
    try {
      const supabase = await loadSupabase();

      const result =
        await supabase.auth.signInWithOAuth({
          provider: "custom:kick",

          options: {
            redirectTo: window.location.origin
          }
        });

      if (result.error) {
        throw result.error;
      }

    } catch (error) {
      console.error(error);

      alert(
        error.message ||
        "تعذر تسجيل الدخول عبر Kick."
      );
    }
  }

  /* =========================
     USER
  ========================= */

  async function refreshMe() {
    const badge = $("pointsBadge");
    const loginButton = $("kickLogin");

    if (!state.session) {
      if (badge) {
        badge.style.display = "none";
      }

      if (loginButton) {
        loginButton.textContent =
          "تسجيل الدخول بـ Kick";

        loginButton.disabled = false;
        loginButton.style.opacity = "1";
      }

      return;
    }

    try {
      const response = await fetch(
        "/api/store/me",
        {
          headers: {
            Authorization:
              `Bearer ${state.session.access_token}`
          }
        }
      );

      const data = await response.json();

      if (response.ok) {
        state.me = data.user;

        if (badge) {
          badge.textContent =
            format(state.me.points);

          badge.style.display =
            "inline-block";
        }

        if (loginButton) {
          loginButton.textContent =
            `مرحباً ${state.me.username}`;

          loginButton.disabled = true;
          loginButton.style.opacity = ".85";
        }

      } else if (
        response.status === 403 &&
        loginButton
      ) {
        loginButton.disabled = false;
        loginButton.textContent =
          "ربط حساب Kick";
      }

    } catch (error) {
      console.error(
        "refreshMe:",
        error
      );
    }
  }

  async function refreshSession() {
    const supabase = await loadSupabase();

    const {
      data,
      error
    } = await supabase.auth.getSession();

    if (error) {
      throw error;
    }

    state.session = data.session;

    await refreshMe();

    supabase.auth.onAuthStateChange(
      (_event, session) => {
        state.session = session;

        refreshMe()
          .catch(console.error);
      }
    );
  }

  /* =========================
     CHECKOUT
  ========================= */

  async function checkout() {
    if (!state.cart.length) {
      alert("السلة فارغة.");
      return;
    }

    if (!state.session) {
      await loginKick();
      return;
    }

    const total = state.cart.reduce(
      (sum, product) =>
        sum + Number(product.price || 0),
      0
    );

    const confirmed = confirm(
      `سيتم خصم ${format(total)}.\n\nهل تريد المتابعة؟`
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(
        "/api/store/spend",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization:
              `Bearer ${state.session.access_token}`
          },

          body: JSON.stringify({
            amount: total,
            reason: "store-checkout"
          })
        }
      );

      const data =
        await response.json()
          .catch(() => ({}));

      if (!response.ok) {
        if (
          data.error ===
          "INSUFFICIENT_POINTS"
        ) {
          alert(
            `رصيدك غير كافٍ.\nالرصيد الحالي: ${format(data.balance)}`
          );

          return;
        }

        if (
          data.error ===
          "KICK_LINK_REQUIRED"
        ) {
          alert(
            "سجّل الدخول بحساب Kick ثم أعد المحاولة."
          );

          return;
        }

        alert(
          data.message ||
          "تعذر إتمام الطلب."
        );

        return;
      }

      state.cart = [];

      updateCart();

      await refreshMe();

      closeCart();

      alert(
        "تم خصم النقاط بنجاح ✅"
      );

    } catch (error) {
      console.error(error);

      alert(
        "حدث خطأ أثناء تنفيذ الطلب."
      );
    }
  }

  /* =========================
     WATCH KICK
  ========================= */

  function injectWatchUI() {
    if ($("watchArea")) {
      return;
    }

    const main =
      document.querySelector("main");

    if (!main) {
      return;
    }

    const section =
      document.createElement("section");

    section.className = "section";

    section.id = "watchSection";

    section.innerHTML = `
      <div class="section-head">
        <h2>مشاهدة Kick</h2>

        <button
          id="startWatch"
          class="primary">
          ابدأ المشاهدة
        </button>
      </div>

      <div id="watchArea">
        <p style="color:#9ca3af">
          سجّل الدخول بـ Kick لبدء جلسة المشاهدة.
        </p>
      </div>
    `;

    main.appendChild(section);

    $("startWatch")?.addEventListener(
      "click",
      startWatch
    );
  }

  async function startWatch() {
    if (!state.session) {
      await loginKick();
      return;
    }

    if (state.watch?.sessionId) {
      return;
    }

    try {
      const response = await fetch(
        "/api/store/watch/start",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${state.session.access_token}`
          }
        }
      );

      const data =
        await response.json()
          .catch(() => ({}));

      if (!response.ok) {
        if (
          data.error ===
          "STREAM_OFFLINE"
        ) {
          alert(
            "البث غير مباشر حالياً."
          );
        } else {
          alert(
            data.message ||
            "تعذر بدء المشاهدة."
          );
        }

        return;
      }

      state.watch = data;

      const area = $("watchArea");

      if (area) {
        area.innerHTML = `
          <div
            style="
              background:#000;
              border-radius:16px;
              overflow:hidden;
            ">

            <iframe
              src="https://player.kick.com/${encodeURIComponent(data.channel)}"
              style="
                width:100%;
                height:420px;
                border:0;
              "
              allowfullscreen>
            </iframe>

          </div>

          <button
            id="stopWatch"
            class="primary"
            style="margin-top:10px">
            إيقاف المشاهدة
          </button>
        `;
      }

      $("stopWatch")?.addEventListener(
        "click",
        stopWatch
      );

      state.heartbeat =
        setInterval(
          sendHeartbeat,
          Number(data.heartbeatMs || 60000)
        );

      await refreshMe();

    } catch (error) {
      console.error(error);

      alert(
        "حدث خطأ أثناء بدء المشاهدة."
      );
    }
  }

  async function sendHeartbeat() {
    if (
      !state.watch ||
      !state.session
    ) {
      return;
    }

    try {
      const response = await fetch(
        "/api/store/watch/heartbeat",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${state.session.access_token}`
          },

          body: JSON.stringify({
            sessionId:
              state.watch.sessionId
          })
        }
      );

      const data =
        await response.json()
          .catch(() => ({}));

      if (!response.ok) {
        clearWatchHeartbeat();

        state.watch = null;

        if (
          data.error ===
          "INSUFFICIENT_POINTS"
        ) {
          alert(
            "انتهت نقاطك. تم إيقاف المشاهدة."
          );

        } else if (
          data.error ===
          "STREAM_OFFLINE"
        ) {
          alert(
            "انتهى البث."
          );

        } else {
          alert(
            data.message ||
            "انتهت جلسة المشاهدة."
          );
        }

        return;
      }

      if (data.charged) {
        await refreshMe();
      }

    } catch (error) {
      console.error(
        "heartbeat:",
        error
      );
    }
  }

  function clearWatchHeartbeat() {
    if (state.heartbeat) {
      clearInterval(
        state.heartbeat
      );

      state.heartbeat = null;
    }
  }

  async function stopWatch() {
    clearWatchHeartbeat();

    if (
      state.watch &&
      state.session
    ) {
      try {
        await fetch(
          "/api/store/watch/stop",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              Authorization:
                `Bearer ${state.session.access_token}`
            },

            body: JSON.stringify({
              sessionId:
                state.watch.sessionId
            })
          }
        );
      } catch (error) {
        console.error(error);
      }
    }

    state.watch = null;

    const area = $("watchArea");

    if (area) {
      area.innerHTML = `
        <p style="color:#9ca3af">
          تم إيقاف المشاهدة.
        </p>
      `;
    }

    await refreshMe();
  }

  /* =========================
     SEARCH
  ========================= */

  function setupSearch() {
    const search = $("search");

    if (!search) {
      return;
    }

    search.addEventListener(
      "input",
      event => {
        const query =
          event.target.value
            .trim()
            .toLowerCase();

        const filtered =
          state.products.filter(
            product =>
              product.name
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
    try {
      const configResponse =
        await fetch(
          "/api/store/config"
        );

      if (configResponse.ok) {
        state.config =
          await configResponse.json();
      }

      injectAuthUI();
      injectWatchUI();

      try {
        const saved =
          JSON.parse(
            localStorage.getItem(
              "cha9fa_cart"
            ) || "[]"
          );

        state.cart =
          Array.isArray(saved)
            ? saved
            : [];

      } catch {
        state.cart = [];
      }

      renderProducts();
      updateCart();
      setupSearch();

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

      try {
        await refreshSession();
      } catch (error) {
        console.warn(
          "Auth init:",
          error.message
        );
      }

    } catch (error) {
      console.error(
        "Store init:",
        error
      );

      renderProducts();
      updateCart();
    }
  }

  /* =========================
     START
  ========================= */

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
