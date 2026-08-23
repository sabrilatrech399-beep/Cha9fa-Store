(() => {
  const $ = (id) => document.getElementById(id);
  let products = [];
  let me = { authenticated: false };
  let selected = null;

  const money = (n) => `${Number(n).toLocaleString('ar-DZ')} نقطة`;

  function toast(message, bad = false) {
    const el = document.createElement('div');
    el.className = `toast ${bad ? 'bad' : 'ok'}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, { credentials: 'include', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || 'REQUEST_FAILED'), { code: data.error, status: response.status });
    return data;
  }

  function renderAccount() {
    const area = $('accountArea');
    if (!me.authenticated) {
      area.innerHTML = '<a class="login" href="/auth/kick">تسجيل الدخول بواسطة Kick</a>';
      $('points').textContent = '—';
      $('walletNote').textContent = 'سجّل الدخول بحساب Kick لمعرفة رصيدك.';
      return;
    }
    const u = me.user;
    area.innerHTML = `<div class="user-pill"><div><strong>${escapeHtml(u.kick_username)}</strong><small>حساب Kick</small></div><button class="logout" id="logout">خروج</button></div>`;
    $('points').textContent = Number(u.points).toLocaleString('ar-DZ');
    $('walletNote').textContent = 'رصيدك محفوظ في قاعدة البيانات ولا يمكن تغييره من المتجر.';
    $('logout').onclick = async () => { await api('/auth/logout', { method: 'POST', body: '{}' }); location.reload(); };
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }

  function renderProducts() {
    $('productsGrid').innerHTML = products.map(p => {
      const canBuy = me.authenticated && Number(me.user.points) >= Number(p.price_points);
      return `<article class="card">
        <div class="product-img"><img src="images/diamond.png" alt="جواهر"></div>
        <h3>${escapeHtml(p.name)}</h3>
        <div class="price">${money(p.price_points)}</div>
        <button class="add ${canBuy ? 'ready' : ''}" data-product="${p.id}" ${canBuy ? '' : 'disabled'}>${canBuy ? 'استبدال الآن' : (me.authenticated ? 'النقاط غير كافية' : 'سجّل الدخول أولاً')}</button>
      </article>`;
    }).join('');
    document.querySelectorAll('[data-product]').forEach(btn => btn.addEventListener('click', () => openOrder(btn.dataset.product)));
  }

  function openOrder(productId) {
    if (!me.authenticated) return location.href = '/auth/kick';
    selected = products.find(p => p.id === productId);
    if (!selected) return;
    $('modalTitle').textContent = selected.name;
    $('modalPrice').textContent = `سيتم خصم ${money(selected.price_points)} من رصيدك.`;
    $('formError').hidden = true;
    $('orderForm').reset();
    $('modalBackdrop').hidden = false;
    document.querySelector('input[name="playerName"]').focus();
  }

  function closeOrder() {
    $('modalBackdrop').hidden = true;
    selected = null;
  }

  $('closeModal').onclick = closeOrder;
  $('modalBackdrop').addEventListener('click', (e) => { if (e.target === $('modalBackdrop')) closeOrder(); });

  $('orderForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selected || !me.authenticated) return;
    const form = new FormData(e.currentTarget);
    const submit = $('submitOrder');
    const error = $('formError');
    submit.disabled = true;
    error.hidden = true;
    try {
      const result = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          productId: selected.id,
          playerName: String(form.get('playerName') || '').trim(),
          country: String(form.get('country') || '').trim(),
          gameId: String(form.get('gameId') || '').trim(),
        }),
      });
      me.user.points = result.points;
      renderAccount();
      renderProducts();
      closeOrder();
      toast('تم تسجيل طلبك وخصم النقاط بنجاح.');
    } catch (err) {
      const messages = {
        INSUFFICIENT_POINTS: 'رصيد النقاط غير كافٍ لهذه الباقة.',
        PRODUCT_NOT_FOUND: 'هذه الباقة غير متاحة حاليًا.',
        INVALID_PLAYER_NAME: 'تحقق من اسم اللعبة.',
        INVALID_COUNTRY: 'تحقق من اسم الدولة.',
        INVALID_GAME_ID: 'تحقق من ID اللعبة.',
        AUTH_REQUIRED: 'انتهت جلسة الدخول. سجّل الدخول مرة أخرى.',
        RATE_LIMITED: 'تم إرسال طلبات كثيرة بسرعة. انتظر قليلًا ثم حاول مرة أخرى.',
        ORIGIN_REJECTED: 'تم رفض الطلب لأسباب أمنية. أعد فتح المتجر من رابطه الرسمي.',
      };
      error.textContent = messages[err.code] || 'تعذر تنفيذ الاستبدال الآن. حاول مرة أخرى.';
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  async function boot() {
    try {
      const [session, catalog] = await Promise.all([api('/api/me'), api('/api/products')]);
      me = session;
      products = catalog.products || [];
      renderAccount();
      renderProducts();
    } catch (error) {
      $('walletNote').textContent = 'تعذر الاتصال بخادم المتجر.';
      $('productsGrid').innerHTML = '<p class="form-error">تعذر تحميل الباقات. تأكد من تشغيل خادم المتجر.</p>';
    }
  }

  boot();
})();
