(() => {
  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const money = (n) => Number(n || 0).toLocaleString('ar-DZ');
  const statusText = (s) => ({ pending: 'قيد المعالجة', processing: 'جارٍ التجهيز', completed: 'تم التسليم', cancelled: 'ملغى' }[s] || s);
  const directionText = (s) => s === 'credit' ? 'إضافة' : 'خصم';

  async function completeOrder(id) {
    if (!confirm('هل تم تسليم الجواهر لهذا المشاهد؟')) return;
    const response = await fetch(`/api/admin/orders/${encodeURIComponent(id)}/complete`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { alert(data.error === 'ORDER_NOT_PENDING' ? 'الطلب لم يعد قيد الانتظار.' : 'تعذر تحديث حالة الطلب.'); return; }
    await load();
  }

  async function load() {
    const response = await fetch('/api/admin/overview', { credentials: 'include' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'ADMIN_ERROR');
    const users = data.users || [], orders = data.orders || [], ledger = data.ledger || [], watchEvents = data.watchEvents || [];
    document.getElementById('adminStats').innerHTML = `
      <article class="card"><h3>المشاهدون</h3><strong>${users.length}</strong></article>
      <article class="card"><h3>الطلبات</h3><strong>${orders.length}</strong></article>
      <article class="card"><h3>إجمالي النقاط الحالية</h3><strong>${money(users.reduce((s, u) => s + Number(u.points || 0), 0))}</strong></article>
      <article class="card"><h3>نقاط المشاهدة المسجلة</h3><strong>${money(ledger.filter(x => x.source === 'watch' && x.direction === 'credit').reduce((s, x) => s + Number(x.amount || 0), 0))}</strong></article>`;
    document.getElementById('usersTable').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Kick ID</th><th>اسم Kick</th><th>النقاط</th><th>آخر تحديث</th></tr></thead><tbody>${users.map((u) => `<tr><td>${esc(u.kick_user_id)}</td><td>${esc(u.kick_username)}</td><td><b>${money(u.points)}</b></td><td>${new Date(u.updated_at).toLocaleString('ar-DZ')}</td></tr>`).join('')}</tbody></table></div>`;
    document.getElementById('ordersTable').innerHTML = `<div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>الجواهر</th><th>النقاط</th><th>اسم اللعبة</th><th>الدولة</th><th>ID اللعبة</th><th>قبل</th><th>بعد</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>${orders.map((o) => `<tr><td>${new Date(o.created_at).toLocaleString('ar-DZ')}</td><td>${money(o.diamonds)}</td><td>${money(o.price_points)}</td><td>${esc(o.player_name)}</td><td>${esc(o.country)}</td><td>${esc(o.game_id)}</td><td>${money(o.points_before)}</td><td>${money(o.points_after)}</td><td>${esc(statusText(o.status))}</td><td>${o.status === 'pending' ? `<button class="submit" data-complete-order="${esc(o.id)}">تم التسليم</button>` : '—'}</td></tr>`).join('')}</tbody></table></div>`;
    document.getElementById('ledgerTable').innerHTML = `<div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>المستخدم</th><th>الحركة</th><th>المصدر</th><th>النقاط</th><th>السبب</th><th>الطلب</th></tr></thead><tbody>${ledger.map((x) => `<tr><td>${new Date(x.created_at).toLocaleString('ar-DZ')}</td><td>${esc(x.store_user_id)}</td><td>${directionText(x.direction)}</td><td>${esc(x.source || '—')}</td><td>${money(x.amount)}</td><td>${esc(x.reason)}</td><td>${esc(x.order_id || '—')}</td></tr>`).join('') || '<tr><td colspan="7">لا توجد حركات بعد.</td></tr>'}</tbody></table></div>`;
    document.getElementById('watchTable').innerHTML = `<div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>المستخدم</th><th>القناة</th><th>النقاط المضافة</th><th>Event Key</th></tr></thead><tbody>${watchEvents.map((x) => `<tr><td>${new Date(x.created_at).toLocaleString('ar-DZ')}</td><td>${esc(x.store_user_id)}</td><td>${esc(x.channel_slug)}</td><td>${money(x.points)}</td><td>${esc(x.event_key)}</td></tr>`).join('') || '<tr><td colspan="5">لا توجد أحداث مشاهدة بعد.</td></tr>'}</tbody></table></div>`;
    document.querySelectorAll('[data-complete-order]').forEach((button) => button.addEventListener('click', () => completeOrder(button.dataset.completeOrder)));
  }
  load().catch((error) => { const element = document.getElementById('adminError'); element.hidden = false; element.textContent = error.message === 'ADMIN_REQUIRED' ? 'هذه الصفحة مخصصة لصاحب المتجر فقط.' : 'تعذر تحميل لوحة التحكم.'; });
})();
