/* 闲鱼自动分销 SaaS — 前端 SPA */
'use strict';
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMoney = (n) => '¥' + (+n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtTime = (t) => t ? new Date(t).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';

let TOKEN = localStorage.getItem('fx_token') || '';
let ME = JSON.parse(localStorage.getItem('fx_me') || 'null');
let currentPage = 'dashboard';
let pollTimer = null;

/* ---------- API ---------- */
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { logout(); throw new Error('未登录'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

/* ---------- Toast / Modal ---------- */
let toastTimer;
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}
function openModal(html) { $('#modalBox').innerHTML = html; $('#modalMask').classList.remove('hidden'); }
function closeModal() { $('#modalMask').classList.add('hidden'); }
$('#modalMask').addEventListener('click', e => { if (e.target === $('#modalMask')) closeModal(); });

/* ---------- 登录/登出 ---------- */
async function doLogin(username, password) {
  const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || '登录失败');
  TOKEN = d.token; ME = d.user;
  localStorage.setItem('fx_token', TOKEN);
  localStorage.setItem('fx_me', JSON.stringify(ME));
  enterApp();
}
function logout() {
  fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN } }).catch(() => {});
  TOKEN = ''; ME = null;
  localStorage.removeItem('fx_token'); localStorage.removeItem('fx_me');
  location.reload();
}
function enterApp() {
  $('#loginPage').classList.add('hidden');
  $('#app').classList.remove('hidden');
  const roleMap = { super_admin: '超级管理员', store_admin: '店铺管理员', operator: '运营人员' };
  $('#userBadge').textContent = `${ME.name} · ${roleMap[ME.role]}`;
  buildNav();
  nav(currentPage);
  startPoll();
}

/* ---------- 导航 ---------- */
const NAV = [
  { group: '经营概览' },
  { id: 'dashboard', icon: '📊', label: '数据看板', perm: 'view' },
  { group: '店铺与商品' },
  { id: 'stores', icon: '🏬', label: '店铺管理' },
  { id: 'goods', icon: '📦', label: '货源商品库' },
  { id: 'publish', icon: '🚀', label: '铺货管理' },
  { id: 'listings', icon: '🔗', label: '商品关联' },
  { group: '交易链路' },
  { id: 'orders', icon: '🧾', label: '订单管理' },
  { id: 'purchases', icon: '🛒', label: '采购管理' },
  { id: 'shipping', icon: '🚚', label: '发货管理' },
  { id: 'aftersales', icon: '🔄', label: '售后管理' },
  { group: '系统' },
  { id: 'users', icon: '👥', label: '用户管理', perm: 'super' },
  { id: 'logs', icon: '📝', label: '操作日志' },
];
function buildNav() {
  const nav = $('#nav');
  nav.innerHTML = NAV.map(n => {
    if (n.group) return `<div class="nav-group">${n.group}</div>`;
    if (n.perm === 'super' && ME.role !== 'super_admin') return '';
    if (n.perm === 'view' && ME.role === 'operator') return `<div class="nav-item" data-page="${n.id}"><span class="icon">${n.icon}</span>${n.label}</div>`;
    return `<div class="nav-item" data-page="${n.id}"><span class="icon">${n.icon}</span>${n.label}</div>`;
  }).join('');
  $$('.nav-item', nav).forEach(el => el.addEventListener('click', () => nav(el.dataset.page)));
}
function nav(page) {
  currentPage = page;
  $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  const item = NAV.find(n => n.id === page);
  $('#pageTitle').textContent = item ? item.label : '';
  stopLoaders();
  renderPage();
}

/* ---------- 轮询刷新 ---------- */
function startPoll() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    refreshNotif();
    if (['orders', 'purchases', 'publish', 'shipping', 'aftersales', 'dashboard'].includes(currentPage)) renderPage(true);
  }, 6000);
  refreshNotif();
}
let notifOpen = false;
async function refreshNotif() {
  try {
    const d = await api('/notifications');
    $('#notifDot').classList.toggle('hidden', d.unread === 0);
    if (notifOpen) renderNotifPanel(d);
  } catch {}
}
function renderNotifPanel(d) {
  const icons = { order: '🧾', purchase: '🛒', ship: '🚚', publish: '🚀', aftersale: '🔄', auth: '🔑', store: '🏬' };
  $('#notifPanel').innerHTML = `<div style="display:flex;justify-content:space-between;padding:6px 12px"><b>消息通知</b><a id="readAll">全部已读</a></div>` +
    (d.list.length ? d.list.slice(0, 20).map(n => `<div class="notif-item ${n.read ? '' : 'unread'}">${icons[n.type] || '📢'} ${esc(n.text)}<span class="nt-time">${fmtTime(n.at)}</span></div>`).join('') : '<div class="empty" style="padding:24px">暂无消息</div>');
  $('#readAll').onclick = async () => { await api('/notifications/read', { method: 'POST' }); refreshNotif(); };
}
$('#notifBtn').addEventListener('click', () => {
  notifOpen = !notifOpen;
  $('#notifPanel').classList.toggle('hidden', !notifOpen);
  if (notifOpen) refreshNotif();
});

/* ---------- 页面路由 ---------- */
const renderers = {};
function renderPage(silent) {
  const c = $('#pageContent');
  if (!silent) c.innerHTML = '<div class="empty"><div class="em">⏳</div>加载中…</div>';
  (renderers[currentPage] || (() => {}))(c, silent).catch(e => {
    if (!silent) c.innerHTML = `<div class="empty"><div class="em">⚠️</div>${esc(e.message)}</div>`;
  });
}
function stopLoaders() {}

/* ============ 1. 数据看板 ============ */
renderers.dashboard = async (c) => {
  const d = await api('/stats?range=14');
  c.innerHTML = `
  <div class="filter-bar">
    <select id="stRange"><option value="1">今天</option><option value="3">近3天</option><option value="7" selected>近7天</option><option value="14">近14天</option><option value="30">近30天</option></select>
    <select id="stStore"><option value="">全部店铺</option>${d.storeOptions.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
  </div>
  <div class="grid-stats">
    <div class="stat-card"><div class="label">销售总额</div><div class="val money" id="mSales"></div><div class="sub">已成交订单金额</div></div>
    <div class="stat-card"><div class="label">采购总额</div><div class="val" id="mPurchase"></div><div class="sub">向供应商采购成本</div></div>
    <div class="stat-card"><div class="label">总利润</div><div class="val" style="color:var(--green)" id="mProfit"></div><div class="sub" id="mProfitRate"></div></div>
    <div class="stat-card"><div class="label">订单量</div><div class="val" id="mOrders"></div><div class="sub" id="mDone"></div></div>
  </div>
  <div class="card"><h3>📈 销售与利润趋势</h3>
    <div class="chart" id="trendChart"></div>
    <div class="legend"><span><i style="background:var(--primary)"></i>销售额</span><span><i style="background:var(--green)"></i>利润</span></div>
  </div>
  <div class="two-col">
    <div class="card"><h3>🏬 分店数据</h3><table class="table"><thead><tr><th>店铺</th><th>商品数</th><th>订单量</th><th>销售额</th><th>利润</th></tr></thead><tbody id="perStore"></tbody></table></div>
    <div class="card"><h3>⏳ 待采购预估</h3>
      <div class="stat-card" style="box-shadow:none;padding:0"><div class="val money" id="mPending"></div><div class="sub" id="mPendingCnt"></div></div>
      <p class="muted" style="margin-top:14px;line-height:1.8">待采购订单为已关联货源、尚未生成/确认采购单的订单。开启「亏损单过滤」后，预估利润 ≤ 0 的订单将自动拦截。</p>
    </div>
  </div>`;
  $('#stRange').onchange = $('#stStore').onchange = () => renderPage();
  $('#stRange').value = d.trend.length;
  $('#mSales').textContent = fmtMoney(d.sales);
  $('#mPurchase').textContent = fmtMoney(d.purchase);
  $('#mProfit').textContent = fmtMoney(d.profit);
  $('#mProfitRate').textContent = d.sales > 0 ? '利润率 ' + (d.profit / d.sales * 100).toFixed(1) + '%' : '—';
  $('#mOrders').textContent = d.orderCount;
  $('#mDone').textContent = `已完成 ${d.doneCount} 笔`;
  $('#mPending').textContent = fmtMoney(d.pendingProfit);
  $('#mPendingCnt').textContent = `待采购订单 ${d.pendingCount} 笔的预估利润`;
  const maxV = Math.max(...d.trend.map(t => t.sales), 1);
  $('#trendChart').innerHTML = d.trend.map(t => `<div class="bar-w" title="${t.date} 销售${fmtMoney(t.sales)} 利润${fmtMoney(t.profit)}">
    <div class="bar" style="height:${Math.max(3, t.sales / maxV * 100)}%"></div>
    <div class="bar g" style="height:${Math.max(3, Math.abs(t.profit) / maxV * 100)}%;width:40%"></div>
    <span class="lbl">${t.date}</span></div>`).join('');
  $('#perStore').innerHTML = d.perStore.map(s => `<tr><td>${esc(s.name)}</td><td>${s.products}</td><td>${s.orders}</td><td>${fmtMoney(s.sales)}</td><td style="color:var(--green)">${fmtMoney(s.profit)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">暂无数据</td></tr>';
};

/* ============ 2. 店铺管理 ============ */
renderers.stores = async (c) => {
  const d = await api('/stores');
  c.innerHTML = `
  <div class="filter-bar">
    <input id="stKw" placeholder="🔍 搜索店铺名称">
    <select id="stStatus"><option value="">全部状态</option><option value="valid">授权有效</option><option value="expired">已过期</option></select>
    <button class="btn primary" id="bindBtn">＋ 绑定闲鱼店铺</button>
  </div>
  <div class="store-grid" id="storeGrid"></div>`;
  const kw = $('#stKw'), status = $('#stStatus');
  const draw = (list) => {
    $('#storeGrid').innerHTML = list.length ? list.map(s => `
      <div class="store-card">
        <div class="head"><div><div class="name">🐟 ${esc(s.name)}</div><div class="meta">评分 ${s.score} · 绑定于 ${fmtTime(s.bindAt)}</div></div>
        ${s.authStatus === 'valid' ? `<span class="tag green">授权有效 · ${s.authExpireDays}天</span>` : '<span class="tag red">授权已过期</span>'}</div>
        <div class="nums"><div><b>${s.productsCount}</b><span>铺货商品</span></div><div><b>${s.ordersCount}</b><span>累计订单</span></div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn sm ghost" data-act="settings" data-id="${s.id}">⚙️ 分销设置</button>
          <button class="btn sm ghost" data-act="sync" data-id="${s.id}">🔄 同步信息</button>
          ${ME.role !== 'operator' ? `<button class="btn sm danger" data-act="unbind" data-id="${s.id}" data-name="${esc(s.name)}">解绑</button>` : ''}
        </div>
      </div>`).join('') : '<div class="card empty"><div class="em">🏬</div>还没有绑定闲鱼店铺，点击右上角「绑定闲鱼店铺」开始</div>';
    $$('#storeGrid [data-act]').forEach(b => b.addEventListener('click', () => storeAction(b.dataset)));
  };
  const filter = () => draw(d.list.filter(s => (!kw.value || s.name.includes(kw.value)) && (!status.value || s.authStatus === status.value)));
  kw.oninput = filter; status.onchange = filter;
  draw(d.list);
  $('#bindBtn').addEventListener('click', () => bindWizard());
};
function storeAction(ds) {
  if (ds.act === 'sync') { api(`/stores/${ds.id}/sync`, { method: 'POST' }).then(() => { toast('店铺信息已同步'); renderPage(); }).catch(e => toast(e.message, 1)); }
  if (ds.act === 'unbind') {
    openModal(`<h3>解除店铺绑定</h3><p style="line-height:1.8">确定解绑「<b>${ds.name}</b>」？解绑后该店铺的铺货商品将移除，<b style="color:var(--red)">订单与统计数据保留</b>。</p>
    <div class="modal-foot"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn danger" id="okUnbind">确认解绑</button></div>`);
    $('#okUnbind').onclick = () => api(`/stores/${ds.id}/unbind`, { method: 'POST' }).then(() => { closeModal(); toast('已解绑'); renderPage(); });
  }
  if (ds.act === 'settings') settingsModal(ds.id);
}
async function settingsModal(id) {
  const { store: s } = await api(`/stores/${id}`);
  openModal(`<h3>⚙️ 分销设置 — ${esc(s.name)}</h3>
  <div class="settings-form">
    <div class="form-item"><label>加价率（售价 = 货源价 × 加价率）</label><input id="fMarkup" type="number" step="0.05" value="${s.markupRate}"></div>
    <div class="form-item"><label>运费加价（元，0 为包邮）</label><input id="fFreight" type="number" step="0.5" value="${s.freight}"></div>
    <div class="form-item"><label>上架方式</label><select id="fPublishMode"><option value="auto" ${s.publishMode === 'auto' ? 'selected' : ''}>直接上架</option><option value="draft" ${s.publishMode === 'draft' ? 'selected' : ''}>进入草稿箱</option></select></div>
    <div class="form-item"><label>运费模板</label><select id="fTemplate"><option ${s.freightTemplate === '包邮模板' ? 'selected' : ''}>包邮模板</option><option ${s.freightTemplate === '顺丰模板' ? 'selected' : ''}>顺丰模板</option></select></div>
    <div class="form-item"><label>订单回流方式</label><select id="fFlow"><option value="auto" ${s.orderFlow === 'auto' ? 'selected' : ''}>实时自动回流</option><option value="manual" ${s.orderFlow === 'manual' ? 'selected' : ''}>手动批量回流</option></select></div>
    <div class="form-item"><label>采购价策略</label><select id="fStrategy">${['最低价', '包邮价', '代发价', '批发价'].map(x => `<option ${s.priceStrategy === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
    <div class="form-item full"><label class="check-line"><input type="checkbox" id="fLoss" class="checkbox" ${s.lossFilter ? 'checked' : ''}> 亏损单过滤（预估利润 ≤ 0 自动拦截）</label></div>
    <div class="form-item full"><label>采购自动备注</label><input id="fRemark" value="${esc(s.autoRemark)}"></div>
    <div class="form-item full"><label>发货时机</label><select id="fShipTiming">${['不自动发货', '揽收时发货', '有物流单号即发货'].map(x => `<option ${s.shipTiming === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
  </div>
  <div class="modal-foot"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" id="saveSettings">保存设置</button></div>`);
  $('#saveSettings').onclick = async () => {
    await api(`/stores/${id}/settings`, {
      method: 'PUT',
      body: {
        markupRate: +$('#fMarkup').value, freight: +$('#fFreight').value,
        publishMode: $('#fPublishMode').value, freightTemplate: $('#fTemplate').value,
        orderFlow: $('#fFlow').value, priceStrategy: $('#fStrategy').value,
        lossFilter: $('#fLoss').checked, autoRemark: $('#fRemark').value, shipTiming: $('#fShipTiming').value,
      },
    });
    closeModal(); toast('设置已保存');
  };
}
/* 绑定向导：模拟闲管家五步授权 */
function bindWizard() {
  openModal(`<h3>绑定闲鱼店铺（闲管家授权）</h3>
  <div class="steps">${['跳转授权', '登录闲管家', '创建店铺', '开通服务', '完成绑定'].map((s, i) => `<div class="step" data-step="${i}">${s}</div>`).join('')}</div>
  <div class="bind-visual" id="bindBody"></div>
  <div class="modal-foot"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" id="bindNext" disabled>请稍候…</button></div>`);
  const body = $('#bindBody'), next = $('#bindNext');
  let step = 0;
  const draw = (html, btnText, enabled) => { body.innerHTML = html; next.textContent = btnText; next.disabled = !enabled; $$('.step').forEach((el, i) => el.classList.toggle('active', i <= step)); };
  const screens = [
    [`即将跳转至 <b>闲管家开放平台</b>（open.xianguanjia.com）授权页面…<br><span class="mono" style="color:var(--text3)">GET https://open.xianguanjia.com/oauth/authorize?client_id=FX_SAAS&scope=shop,product,order,logistics</span>`, '前往授权', true],
    [`请登录闲管家账号（已模拟完成）<br><span class="ok">✓ 手机号 + 验证码登录成功</span><br><span class="ok">✓ 钉钉扫码校验通过</span>`, '下一步', true],
    [`创建闲鱼店铺：已自动使用本机手机号（138****${rint8()}）<br><span class="ok">✓ 验证码校验通过</span><br><span class="ok">✓ 店铺创建成功</span>`, '下一步', true],
    [`在闲管家应用市场开通「<b>分销上货管家</b>」<br><span class="ok">✓ 铂金版 / ERP 专业版 已开通</span>`, '获取授权 Token', true],
    ['', '完成绑定', false],
  ];
  draw(...screens[0]);
  next.onclick = async () => {
    if (step < 4) { step++; draw(...screens[step]); if (step === 4) await finish(); return; }
    closeModal(); toast('店铺绑定成功'); renderPage();
  };
  async function finish() {
    try {
      const r = await api('/stores/bind', { method: 'POST', body: {} });
      draw(`<span class="ok">✓ 授权 Token 获取成功</span><br><span class="mono">token: ${r.store.name ? 'xgj_tok_****' + Math.random().toString(36).slice(2, 8) : ''}</span><br><span class="ok">✓ 店铺「${esc(r.store.name)}」绑定完成，授权有效期 90 天</span>`, '完成绑定', true);
    } catch (e) { draw('绑定失败：' + esc(e.message), '重试', true); }
  }
}
const rint8 = () => Math.floor(10000000 + Math.random() * 89999999);

/* ============ 3. 货源商品库 ============ */
let goodsPage = 1, goodsSel = new Set();
renderers.goods = async (c) => {
  const q = new URLSearchParams(locationHashQ());
  const d = await api('/goods?keyword=' + (q.get('kw') || '') + '&category=' + (q.get('cat') || '') + '&page=' + goodsPage);
  const stores = (await api('/stores')).list.filter(s => s.authStatus === 'valid');
  c.innerHTML = `
  <div class="filter-bar">
    <input id="gKw" placeholder="🔍 搜索货源标题 / 供应商" value="${esc(q.get('kw') || '')}">
    <select id="gCat"><option value="">全部分类</option>${d.categories.map(x => `<option ${q.get('cat') === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <input id="gMin" type="number" placeholder="最低价" style="width:90px"><input id="gMax" type="number" placeholder="最高价" style="width:90px">
    <button class="btn" id="gSearch">搜索</button>
    <span style="flex:1"></span>
    <button class="btn primary" id="gPublish" ${stores.length ? '' : 'disabled'}>🚀 一键铺货（已选 <span id="gSelCnt">0</span>）</button>
  </div>
  <div class="goods-grid" id="goodsGrid"></div>
  <div class="page-foot"><span>共 ${d.total} 件货源 · 第 ${d.page} 页</span><div><button class="btn sm ghost" id="pgPrev" ${d.page <= 1 ? 'disabled' : ''}>上一页</button> <button class="btn sm ghost" id="pgNext" ${d.page * 12 >= d.total ? 'disabled' : ''}>下一页</button></div></div>`;
  const draw = (list) => {
    $('#goodsGrid').innerHTML = list.map(g => `
      <div class="goods-card">
        <div class="goods-thumb">${['🎧','📱','👕','👜','👟','🧸','🥤','💄','🎸','⚽','📚','🍜'][g.id.charCodeAt(3) % 12]}</div>
        <div class="body">
          <div class="title"><label class="check-line" style="padding:0"><input type="checkbox" class="checkbox gSel" data-id="${g.id}" ${goodsSel.has(g.id) ? 'checked' : ''}>${esc(g.title)}</label></div>
          <div class="price">${fmtMoney(g.price)} <small>/ 供货价</small></div>
          <div class="muted" style="margin-top:6px">${esc(g.category)} · 库存 ${g.stock} · ${g.shipPrice === 0 ? '包邮' : '运费¥' + g.shipPrice}</div>
          <div class="foot"><span class="muted">${esc(g.supplier)}</span><span><a data-detail="${g.id}">详情</a> <a data-one="${g.id}">铺货</a></span></div>
        </div>
      </div>`).join('');
    $$('.gSel').forEach(cb => cb.addEventListener('change', () => {
      cb.checked ? goodsSel.add(cb.dataset.id) : goodsSel.delete(cb.dataset.id);
      $('#gSelCnt').textContent = goodsSel.size;
    }));
    $$('[data-detail]').forEach(a => a.addEventListener('click', () => goodsDetail(a.dataset.detail)));
    $$('[data-one]').forEach(a => a.addEventListener('click', () => publishModal([a.dataset.one], stores)));
  };
  draw(d.list);
  const reload = () => { locationHashQ({ kw: $('#gKw').value, cat: $('#gCat').value }); goodsPage = 1; renderPage(); };
  $('#gSearch').onclick = reload;
  $('#gKw').onkeydown = e => { if (e.key === 'Enter') reload(); };
  $('#gCat').onchange = reload;
  $('#pgPrev').onclick = () => { goodsPage--; renderPage(); };
  $('#pgNext').onclick = () => { goodsPage++; renderPage(); };
  $('#gPublish').onclick = () => publishModal([...goodsSel], stores);
};
function locationHashQ(set) {
  if (set) { sessionStorage.setItem('fx_gq', JSON.stringify(set)); return set; }
  return JSON.parse(sessionStorage.getItem('fx_gq') || '{}');
}
async function goodsDetail(id) {
  const { goods: g } = await api(`/goods/${id}`);
  openModal(`<h3>📦 货源详情</h3>
  <div class="detail-grid">
    <div class="k">标题</div><div>${esc(g.title)}</div>
    <div class="k">分类</div><div>${esc(g.category)}</div>
    <div class="k">供货价</div><div style="color:var(--primary);font-weight:700">${fmtMoney(g.price)}</div>
    <div class="k">运费</div><div>${g.shipPrice === 0 ? '包邮' : fmtMoney(g.shipPrice)}</div>
    <div class="k">库存</div><div>${g.stock}</div>
    <div class="k">发货时效</div><div>${esc(g.shipTime)}</div>
    <div class="k">供应商</div><div>${esc(g.supplier)}</div>
    <div class="k">来源</div><div><span class="tag blue">1688</span></div>
  </div>
  <h3 style="margin-top:18px">规格</h3>
  <table class="table"><thead><tr><th>规格名</th><th>价格</th></tr></thead><tbody>${g.specs.map(s => `<tr><td>${esc(s.name)}</td><td>${fmtMoney(s.price)}</td></tr>`).join('')}</tbody></table>
  <div class="modal-foot"><button class="btn ghost" onclick="closeModal()">关闭</button></div>`);
}
function publishModal(goodsIds, stores) {
  if (!goodsIds.length) return toast('请先勾选要铺货的货源商品', 1);
  if (!stores.length) return toast('没有授权有效的店铺，请先绑定店铺', 1);
  openModal(`<h3>🚀 一键铺货</h3>
  <p style="margin-bottom:14px">已选 <b>${goodsIds.length}</b> 件货源商品，铺货后售价 = 货源价 × 店铺加价率 + 运费加价</p>
  <div class="form-item"><label>目标店铺（可多选）</label>
  ${stores.map(s => `<label class="check-line"><input type="checkbox" class="checkbox pubStore" value="${s.id}" checked> ${esc(s.name)}（加价率 ${s.markupRate}）</label>`).join('')}</div>
  <div class="bind-visual">铺货规则预览：货源价 <b>¥100</b> → 售价 ≈ <b style="color:var(--primary)">¥140</b>（按加价率 1.4 计算，可在店铺设置中调整）</div>
  <div class="modal-foot"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" id="doPublish">开始铺货</button></div>`);
  $('#doPublish').onclick = async () => {
    const storeIds = $$('.pubStore:checked').map(x => x.value);
    if (!storeIds.length) return toast('请至少选择一家店铺', 1);
    const r = await api('/publish-tasks', { method: 'POST', body: { goodsIds, storeIds } });
    closeModal(); goodsSel.clear();
    toast(`铺货任务已创建（${r.task.total} 件），正在异步执行`);
    currentPage = 'publish'; nav('publish');
  };
}

/* ============ 4. 铺货管理 ============ */
let pubTab = 'running';
renderers.publish = async (c) => {
  const d = await api('/publish/results');
  const tabDef = [['running', '铺货中', d.running.length], ['success', '铺货成功', d.success.length], ['fail', '铺货失败', d.fail.length], ['oos', '已缺货', d.oos.length]];
  c.innerHTML = `<div class="tabs">${tabDef.map(([k, l, n]) => `<div class="tab ${pubTab === k ? 'active' : ''}" data-tab="${k}">${l}<span class="cnt">${n}</span></div>`).join('')}</div><div id="pubBody"></div>`;
  $$('.tab').forEach(t => t.addEventListener('click', () => { pubTab = t.dataset.tab; renderPage(); }));
  const body = $('#pubBody');
  if (pubTab === 'running') {
    body.innerHTML = d.running.length ? d.running.map(t => `<div class="card">
      <div style="display:flex;justify-content:space-between;margin-bottom:10px"><b>任务 ${t.id.slice(-6)}</b><span class="muted">${fmtTime(t.createdAt)} · ${t.done}/${t.total} 件</span></div>
      <div class="progress"><div class="bar" style="width:${t.percent}%"></div></div></div>`).join('') : '<div class="card empty"><div class="em">🚀</div>暂无进行中的铺货任务</div>';
  } else if (pubTab === 'success') {
    body.innerHTML = tableWrap(`<tr><th>商品</th><th>店铺</th><th>货源价</th><th>铺货售价</th><th>状态</th><th>货源关联</th><th>操作</th></tr>` +
      d.success.map(l => `<tr><td>${esc(l.title)}</td><td>${esc(l.storeName)}</td><td>${fmtMoney(l.goodsPrice)}</td><td style="color:var(--primary);font-weight:600">${fmtMoney(l.price)}</td><td>${l.status === 'on' ? '<span class="tag green">已上架</span>' : '<span class="tag gray">草稿箱</span>'}</td><td>${l.goods ? '<span class="tag blue">已关联</span>' : '<span class="tag orange">未关联</span>'}</td><td><a href="#" onclick="return false" data-go="listings">去关联</a></td></tr>`).join(''));
  } else if (pubTab === 'fail') {
    body.innerHTML = tableWrap(`<tr><th>商品</th><th>店铺</th><th>失败原因</th><th>时间</th><th>操作</th></tr>` +
      (d.fail.length ? d.fail.map(f => {
        const g = (renderers.goods_cache || []).find?.(x => x.id === f.goodsId);
        return `<tr><td>货源 ${f.goodsId}</td><td>店铺 ${f.storeId.slice(-4)}</td><td><span class="tag red">${esc(f.reason)}</span></td><td>${fmtTime(f.at)}</td><td><a data-retry="${f.task}">重新铺货</a></td></tr>`;
      }).join('') : '<tr><td colspan="5" class="empty">🎉 没有失败记录</td></tr>'));
    $$('[data-retry]').forEach(a => a.addEventListener('click', async () => {
      await api(`/publish-tasks/${a.dataset.retry}/retry`, { method: 'POST' });
      toast('已创建重试任务'); pubTab = 'running'; renderPage();
    }));
  } else {
    body.innerHTML = tableWrap(`<tr><th>商品</th><th>店铺</th><th>售价</th><th>库存</th><th>操作</th></tr>` +
      (d.oos.length ? d.oos.map(l => `<tr><td>${esc(l.title)}</td><td>${esc(l.storeName)}</td><td>${fmtMoney(l.price)}</td><td><span class="tag red">缺货</span></td><td><a data-goods="${l.goodsId || ''}" data-link-oos="${l.id}">查看货源</a></td></tr>`).join('') : '<tr><td colspan="5" class="empty">暂无缺货商品</td></tr>'));
  }
  $$('[data-go]').forEach(a => a.addEventListener('click', () => nav(a.dataset.go)));
};
function tableWrap(headHtml, bodyHtml) { return `<div class="card" style="overflow-x:auto"><table class="table"><thead>${headHtml}</thead><tbody>${bodyHtml || ''}</tbody></table></div>`; }

/* ============ 5. 商品关联 ============ */
let listFilter = '';
renderers.listings = async (c) => {
  const d = await api('/listings' + (listFilter ? '?linked=no' : ''));
  const stores = (await api('/stores')).list;
  const goodsData = await api('/goods?size=100');
  c.innerHTML = `
  <div class="filter-bar">
    <select id="liStore"><option value="">全部店铺</option>${stores.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
    <input id="liKw" placeholder="🔍 搜索商品标题">
    <label class="check-line"><input type="checkbox" class="checkbox" id="liUnlinked" ${listFilter ? 'checked' : ''}> 只看未关联（${d.unlinkedCount}）</label>
    <span style="flex:1"></span>
    <button class="btn" id="liBatchUpdate">🔄 一键同步货源信息</button>
  </div>
  <div class="card" style="overflow-x:auto"><table class="table"><thead><tr><th></th><th>闲鱼商品</th><th>店铺</th><th>售价</th><th>关联货源</th><th>货源价</th><th>预估单件利润</th><th>状态</th><th>操作</th></tr></thead><tbody>
  ${d.list.map(l => {
    const g = l.goods;
    return `<tr><td><input type="checkbox" class="checkbox liSel" data-id="${l.id}"></td>
    <td style="max-width:220px">${esc(l.title)}</td><td>${esc(l.storeName)}</td><td style="color:var(--primary);font-weight:600">${fmtMoney(l.price)}</td>
    <td>${g ? `${esc(g.title)}<div class="muted">${esc(g.supplier)}</div>` : '<span class="tag orange">未关联</span>'}</td>
    <td>${g ? fmtMoney(g.price) : '—'}</td><td>${g ? `<span style="color:var(--green)">${fmtMoney(l.price - g.price)}</span>` : '—'}</td>
    <td>${l.status === 'on' ? '<span class="tag green">上架中</span>' : l.status === 'draft' ? '<span class="tag gray">草稿</span>' : l.status === 'out_of_stock' ? '<span class="tag red">缺货</span>' : '<span class="tag gray">已下架</span>'}</td>
    <td>${g ? `<a data-unlink="${l.id}">解除</a>` : `<a data-link="${l.id}">关联货源</a>`}</td></tr>`;
  }).join('') || '<tr><td colspan="9" class="empty">暂无商品</td></tr>'}
  </tbody></table></div>`;
  $('#liStore').onchange = $('#liUnlinked').onchange = () => { listFilter = $('#liUnlinked').checked ? 'no' : ''; renderPage(); };
  $('#liKw').onkeydown = e => { if (e.key === 'Enter') renderPage(); };
  $('#liBatchUpdate').onclick = async () => {
    const ids = $$('.liSel:checked').map(x => x.dataset.id);
    if (!ids.length) return toast('请勾选要更新的商品', 1);
    const r = await api('/listings/batch', { method: 'POST', body: { ids, action: 'update' } });
    toast(`已同步更新 ${r.count} 件商品`); renderPage();
  };
  $$('[data-unlink]').forEach(a => a.addEventListener('click', async () => { await api(`/listings/${a.dataset.unlink}/link`, { method: 'DELETE' }); toast('已解除关联'); renderPage(); }));
  $$('[data-link]').forEach(a => a.addEventListener('click', () => linkModal(a.dataset.link, goodsData.list)));
};
function linkModal(listingId, goodsList) {
  openModal(`<h3>🔗 手动关联货源</h3>
  <p class="muted" style="margin-bottom:12px">粘贴货源商品 ID 或从下方列表选择（真实环境支持粘贴 1688 链接自动解析）</p>
  <input id="lkSearch" placeholder="🔍 搜索货源标题">
  <div style="max-height:320px;overflow-y:auto;margin-top:10px" id="lkList"></div>
  <div class="modal-foot"><button class="btn ghost" onclick="closeModal()">取消</button></div>`);
  const draw = (kw) => {
    $('#lkList').innerHTML = goodsList.filter(g => !kw || g.title.includes(kw)).slice(0, 20).map(g =>
      `<label class="check-line"><input type="radio" name="lkG" class="checkbox" value="${g.id}"> ${esc(g.title)} <span class="muted">${esc(g.supplier)} · ${fmtMoney(g.price)}</span></label>`).join('');
    $$('#lkList input').forEach(r => r.addEventListener('change', async () => {
      await api(`/listings/${listingId}/link`, { method: 'POST', body: { goodsId: r.value } });
      closeModal(); toast('关联成功'); renderPage();
    }));
  };
  draw('');
  $('#lkSearch').oninput = () => draw($('#lkSearch').value.trim());
}

/* ============ 6. 订单管理 ============ */
let orderTab = '';
renderers.orders = async (c) => {
  const d = await api('/orders');
  const stores = (await api('/stores')).list;
  const tabs = [['', '全部', d.counts.all], ['待采购', '待采购', d.counts['待采购']], ['待付款', '待付款', d.counts['待付款']], ['待发货', '待发货', d.counts['待发货']], ['待收货', '待收货', d.counts['待收货']], ['售后中', '售后中', d.counts['售后中']], ['已完成', '已完成', d.counts['已完成']]];
  c.innerHTML = `
  <div class="tabs">${tabs.map(([k, l, n]) => `<div class="tab ${orderTab === k ? 'active' : ''}" data-tab="${k}">${l}<span class="cnt">${n}</span></div>`).join('')}<div class="tab ${orderTab === 'unlinked' ? 'active' : ''}" data-tab="unlinked" style="color:${d.counts.unlinked ? 'var(--red)' : 'inherit'}">⚠️ 未关联货源<span class="cnt">${d.counts.unlinked}</span></div></div>
  <div class="filter-bar">
    <input id="oKw" placeholder="🔍 订单号 / 商品 / 买家">
    <select id="oStore"><option value="">全部店铺</option>${stores.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
    <button class="btn" id="oPull">⬇️ 手动回流订单（近3天）</button>
  </div>
  <div class="card" style="overflow-x:auto"><table class="table"><thead><tr><th>订单号</th><th>商品</th><th>店铺</th><th>买家</th><th>金额</th><th>成本</th><th>利润</th><th>货源</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody id="orderRows"></tbody></table></div>`;
  const draw = (kw, storeId) => {
    let list = d.list;
    if (orderTab === 'unlinked') list = list.filter(o => !o.linked && o.status !== '已关闭');
    else if (orderTab) list = list.filter(o => o.status === orderTab);
    if (kw) list = list.filter(o => o.orderNo.includes(kw) || o.title.includes(kw) || o.buyer.includes(kw));
    if (storeId) list = list.filter(o => o.storeId === storeId);
    const stTag = (s) => ({ '待采购': 'orange', '待付款': 'red', '待发货': 'blue', '待收货': 'blue', '售后中': 'yellow', '已完成': 'green', '已关闭': 'gray' }[s] || 'gray');
    $('#orderRows').innerHTML = list.map(o => `<tr>
      <td class="mono">${esc(o.orderNo)}</td><td style="max-width:180px">${esc(o.title)}${o.qty > 1 ? ` ×${o.qty}` : ''}</td><td>${esc(o.storeName)}</td><td>${esc(o.buyer)}</td>
      <td style="font-weight:600">${fmtMoney(o.amount)}</td><td>${o.cost ? fmtMoney(o.cost) : '—'}</td>
      <td>${o.profit != null ? `<span style="color:${o.profit >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtMoney(o.profit)}</span>` : '—'}</td>
      <td>${o.linked ? '<span class="tag blue">已关联</span>' : '<span class="tag orange">未关联</span>'}</td>
      <td><span class="tag ${stTag(o.status)}">${o.status}</span></td><td class="muted">${fmtTime(o.createdAt)}</td>
      <td><a data-detail="${o.id}">详情</a>${o.status === '待采购' ? ` · <a data-confirm="${o.id}">生成采购单</a>` : ''}${['待采购', '待付款'].includes(o.status) ? ` · <a class="dgr" data-cancel="${o.id}" style="color:var(--red)">取消</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="11" class="empty">暂无订单</td></tr>';
    $$('[data-detail]').forEach(a => a.addEventListener('click', () => orderDetail(a.dataset.detail)));
    $$('[data-confirm]').forEach(a => a.addEventListener('click', async () => {
      try { await api(`/orders/${a.dataset.confirm}/confirm-purchase`, { method: 'POST' }); toast('采购单已生成，请在采购管理中付款'); renderPage(); }
      catch (e) { toast(e.message, 1); }
    }));
    $$('[data-cancel]').forEach(a => a.addEventListener('click', () => api(`/orders/${a.dataset.cancel}/cancel`, { method: 'POST' }).then(() => { toast('订单已取消'); renderPage(); })));
  };
  draw('', '');
  $('#oKw').oninput = () => draw($('#oKw').value.trim(), $('#oStore').value);
  $('#oStore').onchange = () => draw($('#oKw').value.trim(), $('#oStore').value);
  $$('.tab').forEach(t => t.addEventListener('click', () => { orderTab = t.dataset.tab; renderPage(); }));
  $('#oPull').onclick = () => {
    const storeId = $('#oStore').value || (stores[0] && stores[0].id);
    if (!storeId) return toast('请先绑定店铺', 1);
    api('/orders/pull', { method: 'POST', body: { storeId } }).then(r => { toast(`已拉取 ${r.pulled} 笔新订单`); renderPage(); });
  };
};
async function orderDetail(id) {
  const d = await api(`/orders/${id}`);
  const o = d.order;
  openModal(`<h3>🧾 订单详情 <span class="mono muted">${esc(o.orderNo)}</span></h3>
  <div class="detail-grid">
    <div class="k">状态</div><div><span class="tag blue">${o.status}</span></div>
    <div class="k">商品</div><div>${esc(o.title)} × ${o.qty}</div>
    <div class="k">店铺</div><div>${esc(o.storeName)}</div>
    <div class="k">买家</div><div>${esc(o.buyer)}</div>
    <div class="k">订单金额</div><div>${fmtMoney(o.amount)}</div>
    <div class="k">采购成本</div><div>${o.cost ? fmtMoney(o.cost) : '未采购'}</div>
    <div class="k">利润</div><div>${o.profit != null ? fmtMoney(o.profit) : '—'}</div>
    <div class="k">买家备注</div><div>${esc(o.remark) || '—'}</div>
    <div class="k">下单时间</div><div>${fmtTime(o.createdAt)}</div>
  </div>
  ${d.goods ? `<h3 style="margin-top:18px">📦 关联货源</h3><div class="detail-grid"><div class="k">货源商品</div><div>${esc(d.goods.title)}</div><div class="k">供应商</div><div>${esc(d.goods.supplier)}（${esc(d.goods.shipTime)}发货）</div></div>` : ''}
  ${d.purchase ? `<h3 style="margin-top:18px">🛒 采购单</h3><div class="detail-grid"><div class="k">采购状态</div><div>${d.purchase.status}</div><div class="k">物流</div><div>${d.purchase.shipNo ? `${d.purchase.logistics} ${d.purchase.shipNo}` : '未发货'}</div></div>` : ''}
  ${d.aftersale ? `<h3 style="margin-top:18px">🔄 售后</h3><div class="tl">${d.aftersale.timeline.map(t => `<div class="tl-item">${esc(t.text)}<div class="tl-time">${fmtTime(t.at)}</div></div>`).join('')}</div>` : ''}
  <div class="modal-foot"><button class="btn ghost" onclick="closeModal()">关闭</button></div>`);
}

/* ============ 7. 采购管理 ============ */
let purTab = '待付款', purShowPay = false;
renderers.purchases = async (c) => {
  const [d, payData] = await Promise.all([api('/purchases'), api('/payments')]);
  const stores = (await api('/stores')).list;
  const tabs = [['待付款', '待付款'], ['待发货', '待发货'], ['待收货', '待收货'], ['已完成', '已完成'], ['已关闭', '已关闭']];
  c.innerHTML = `
  <div class="tabs">${tabs.map(([k, l]) => `<div class="tab ${purTab === k ? 'active' : ''}" data-tab="${k}">${l}<span class="cnt">${d.counts[k] || 0}</span></div>`).join('')}
  <div class="tab ${purShowPay ? 'active' : ''}" data-tab="__pay">💳 付款记录</div></div>
  <div class="filter-bar">
    <input id="pKw" placeholder="🔍 采购单 / 商品 / 供应商">
    <select id="pStore"><option value="">全部店铺</option>${stores.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
    ${purTab === '待付款' ? `<span style="flex:1"></span><button class="btn primary" id="pPay">付款（已选 <span id="pSelCnt">0</span>）</button><button class="btn" id="pMerge">🔗 合单支付（同供应商同地址）</button>` : ''}
  </div>
  <div id="purBody"></div>`;
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    if (t.dataset.tab === '__pay') { purShowPay = true; renderPage(); return; }
    purShowPay = false; purTab = t.dataset.tab; renderPage();
  }));
  const body = $('#purBody');
  if (purShowPay) {
    body.innerHTML = tableWrap(`<tr><th>支付流水</th><th>方式</th><th>订单数</th><th>金额</th><th>操作人</th><th>时间</th></tr>` +
      (payData.list.length ? payData.list.map(x => `<tr><td class="mono">${x.id}</td><td><span class="tag blue">${x.channel}</span></td><td>${x.orderNos.length}</td><td style="font-weight:600">${fmtMoney(x.amount)}</td><td>${esc(x.operator)}</td><td class="muted">${fmtTime(x.at)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">暂无付款记录</td></tr>'));
    return;
  }
  const draw = (kw, storeId) => {
    let list = d.list.filter(x => x.status === purTab);
    if (kw) list = list.filter(x => x.goodsTitle.includes(kw) || x.supplier.includes(kw) || x.orderNos.some(n => n.includes(kw)));
    if (storeId) list = list.filter(x => x.storeId === storeId);
    body.innerHTML = tableWrap(`<tr><th><input type="checkbox" class="checkbox" id="pAll" ${purTab === '待付款' ? '' : 'disabled'}></th><th>采购单</th><th>商品</th><th>店铺</th><th>供应商</th><th>数量</th><th>采购额</th><th>地址</th><th>物流</th><th>状态</th></tr>` +
      (list.length ? list.map(x => `<tr>
        <td>${purTab === '待付款' ? `<input type="checkbox" class="checkbox pSel" data-id="${x.id}" data-addr="${esc(x.address)}" data-sup="${esc(x.supplier)}">` : ''}</td>
        <td class="mono">${x.orderNos.join('<br>')}</td><td style="max-width:170px">${esc(x.goodsTitle)}</td><td>${esc(x.storeName)}</td><td>${esc(x.supplier)}</td>
        <td>${x.qty}</td><td style="font-weight:600">${fmtMoney(x.amount)}</td><td style="max-width:160px" class="muted">${esc(x.address)}${x.remark ? `<br>备注：${esc(x.remark)}` : ''}</td>
        <td>${x.shipNo ? `${esc(x.logistics)}<div class="mono muted">${x.shipNo}</div>` : '—'}</td>
        <td><span class="tag ${x.status === '已完成' ? 'green' : x.status === '待付款' ? 'red' : 'blue'}">${x.status}</span></td></tr>`).join('') : '<tr><td colspan="10" class="empty">暂无采购单</td></tr>'));
    if (purTab === '待付款') {
      const cnt = () => $('#pSelCnt').textContent = $$('.pSel:checked').length;
      $$('.pSel').forEach(x => x.addEventListener('change', cnt));
      const all = $('#pAll');
      if (all) all.addEventListener('change', () => { $$('.pSel').forEach(x => x.checked = all.checked); cnt(); });
      $('#pPay').onclick = () => payAction(false);
      $('#pMerge').onclick = () => payAction(true);
    }
  };
  function payAction(merge) {
    const sel = $$('.pSel:checked');
    if (!sel.length) return toast('请勾选要付款的采购单', 1);
    const ids = sel.map(x => x.dataset.id);
    if (merge && sel.length < 2) return toast('合单支付至少需要 2 笔', 1);
    api(merge ? '/purchases/merge-pay' : '/purchases/pay', { method: 'POST', body: { ids } })
      .then(r => { toast(`${r.pay.channel}成功，合计 ${fmtMoney(r.pay.amount)}`); renderPage(); })
      .catch(e => toast(e.message, 1));
  }
  draw('', '');
  $('#pKw').oninput = () => draw($('#pKw').value.trim(), $('#pStore').value);
  $('#pStore').onchange = () => draw($('#pKw').value.trim(), $('#pStore').value);
};

/* ============ 8. 发货管理 ============ */
renderers.shipping = async (c) => {
  const d = await api('/shipping');
  c.innerHTML = `
  <div class="card"><h3>⚙️ 发货时机设置（按店铺）</h3>
  <div class="settings-form" style="grid-template-columns:1fr 1fr 1fr">
  ${d.settings.map(s => `<div class="form-item"><label>${esc(s.name)}</label><select data-store="${s.id}" class="shipTiming">${['不自动发货', '揽收时发货', '有物流单号即发货'].map(x => `<option ${s.shipTiming === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>`).join('')}
  </div></div>
  <div class="card" style="overflow-x:auto"><h3>🚚 发货 / 物流跟踪</h3>
  <table class="table"><thead><tr><th>采购单</th><th>商品</th><th>店铺</th><th>状态</th><th>物流单号</th><th>回传闲鱼</th><th>操作</th></tr></thead><tbody>
  ${d.list.length ? d.list.map(x => `<tr><td class="mono">${x.orderNos[0]}</td><td style="max-width:200px">${esc(x.goodsTitle)}</td><td>${esc(x.storeName)}</td>
  <td><span class="tag ${x.status === '待收货' ? 'blue' : 'yellow'}">${x.status}</span></td>
  <td>${x.shipNo ? `${esc(x.logistics)} <span class="mono">${x.shipNo}</span>` : '—'}</td>
  <td>${x.shipNo ? '<span class="tag green">已回传</span>' : '—'}</td>
  <td>${x.status === '待发货' ? `<a data-refresh="${x.id}">刷新物流</a>` : ''}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">暂无待发货 / 运输中采购单</td></tr>'}
  </tbody></table></div>`;
  $$('.shipTiming').forEach(sel => sel.addEventListener('change', async () => {
    await api(`/stores/${sel.dataset.store}/settings`, { method: 'PUT', body: { shipTiming: sel.value } });
    toast('发货时机已更新');
  }));
  $$('[data-refresh]').forEach(a => a.addEventListener('click', async () => {
    const r = await api('/shipping/refresh', { method: 'POST', body: { id: a.dataset.refresh } });
    toast(r.shipped ? `已发货：${r.shipNo}` : r.msg); renderPage();
  }));
};

/* ============ 9. 售后管理 ============ */
renderers.aftersales = async (c) => {
  const d = await api('/aftersales');
  c.innerHTML = `
  <div class="filter-bar"><button class="btn primary" id="afNew">＋ 手动发起售后</button></div>
  <div class="card" style="overflow-x:auto"><table class="table"><thead><tr><th>售后单</th><th>关联订单</th><th>类型</th><th>原因</th><th>退款金额</th><th>状态</th><th>时间</th></tr></thead><tbody>
  ${d.list.length ? d.list.map(a => `<tr><td class="mono">${a.id}</td><td class="mono">${esc(a.orderNo)}</td><td>${esc(a.type)}</td><td>${esc(a.reason)}</td><td style="font-weight:600">${fmtMoney(a.amount)}</td>
  <td><span class="tag ${a.status === '退款成功' ? 'green' : 'yellow'}">${a.status}</span></td><td class="muted">${fmtTime(a.createdAt)}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">暂无售后单</td></tr>'}
  </tbody></table></div>`;
  $('#afNew').onclick = () => {
    openModal(`<h3>手动发起售后</h3>
    <div class="form-item"><label>闲鱼订单号</label><input id="afOrder" placeholder="如 XY123456789"></div>
    <div class="form-item"><label>售后类型</label><select id="afType"><option>仅退款</option><option>退货退款</option></select></div>
    <div class="form-item"><label>原因</label><input id="afReason" placeholder="如 商品与描述不符"></div>
    <div class="modal-foot"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" id="afGo">提交并同步供应商</button></div>`);
    $('#afGo').onclick = async () => {
      try { await api('/aftersales', { method: 'POST', body: { orderNo: $('#afOrder').value.trim(), type: $('#afType').value, reason: $('#afReason').value.trim() } }); closeModal(); toast('售后已发起并同步供应商'); renderPage(); }
      catch (e) { toast(e.message, 1); }
    };
  };
};

/* ============ 10. 用户管理 ============ */
renderers.users = async (c) => {
  if (ME.role !== 'super_admin') { c.innerHTML = '<div class="empty"><div class="em">🔒</div>需要超级管理员权限</div>'; return; }
  const d = await api('/users');
  const roleMap = { super_admin: '超级管理员', store_admin: '店铺管理员', operator: '运营人员' };
  c.innerHTML = `
  <div class="filter-bar"><button class="btn primary" id="uNew">＋ 新建用户</button>
  <span class="muted">RBAC 权限：超级管理员全部权限 · 店铺管理员业务操作 · 运营人员仅查看</span></div>
  <div class="card" style="overflow-x:auto"><table class="table"><thead><tr><th>用户名</th><th>姓名</th><th>角色</th><th>创建时间</th><th>操作</th></tr></thead><tbody>
  ${d.list.map(u => `<tr><td class="mono">${esc(u.username)}</td><td>${esc(u.name)}</td><td><span class="tag ${u.role === 'super_admin' ? 'purple' : u.role === 'store_admin' ? 'blue' : 'gray'}">${roleMap[u.role]}</span></td><td class="muted">${fmtTime(u.createdAt)}</td>
  <td>${u.username === 'admin' ? '—' : `<a data-reset="${u.id}">重置密码</a> · <a style="color:var(--red)" data-del="${u.id}">删除</a>`}</td></tr>`).join('')}
  </tbody></table></div>`;
  $('#uNew').onclick = () => {
    openModal(`<h3>新建用户</h3>
    <div class="form-item"><label>用户名</label><input id="nuName"></div>
    <div class="form-item"><label>姓名</label><input id="nuReal"></div>
    <div class="form-item"><label>密码</label><input id="nuPwd" type="password"></div>
    <div class="form-item"><label>角色</label><select id="nuRole"><option value="store_admin">店铺管理员</option><option value="operator">运营人员</option><option value="super_admin">超级管理员</option></select></div>
    <div class="modal-foot"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" id="nuGo">创建</button></div>`);
    $('#nuGo').onclick = async () => {
      try { await api('/users', { method: 'POST', body: { username: $('#nuName').value.trim(), name: $('#nuReal').value.trim(), password: $('#nuPwd').value, role: $('#nuRole').value } }); closeModal(); toast('用户已创建'); renderPage(); }
      catch (e) { toast(e.message, 1); }
    };
  };
  $$('[data-del]').forEach(a => a.addEventListener('click', () => api(`/users/${a.dataset.del}`, { method: 'DELETE' }).then(() => { toast('已删除'); renderPage(); })));
  $$('[data-reset]').forEach(a => a.addEventListener('click', () => {
    openModal(`<h3>重置密码</h3><div class="form-item"><label>新密码</label><input id="rpPwd" type="password"></div>
    <div class="modal-foot"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" id="rpGo">确认重置</button></div>`);
    $('#rpGo').onclick = async () => { await api(`/users/${a.dataset.reset}`, { method: 'PUT', body: { password: $('#rpPwd').value } }); closeModal(); toast('密码已重置'); };
  }));
};

/* ============ 11. 操作日志 ============ */
renderers.logs = async (c) => {
  const d = await api('/logs');
  c.innerHTML = tableWrap(`<tr><th>时间</th><th>操作人</th><th>操作</th><th>详情</th></tr>`,
    d.list.map(l => `<tr><td class="muted">${fmtTime(l.at)}</td><td>${esc(l.user)}</td><td><span class="tag blue">${esc(l.action)}</span></td><td>${esc(l.detail)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">暂无日志</td></tr>');
};

/* ---------- 启动 ---------- */
$('#loginBtn').addEventListener('click', () => doLogin($('#loginUser').value.trim(), $('#loginPwd').value).catch(e => toast(e.message, 1)));
$('#loginPwd').addEventListener('keydown', e => { if (e.key === 'Enter') $('#loginBtn').click(); });
$$('.login-demo a').forEach(a => a.addEventListener('click', () => {
  const [u, p] = a.dataset.acc.split('|');
  $('#loginUser').value = u; $('#loginPwd').value = p;
  doLogin(u, p).catch(e => toast(e.message, 1));
}));
$('#logoutBtn').addEventListener('click', logout);
if (TOKEN && ME) {
  fetch('/api/me', { headers: { Authorization: 'Bearer ' + TOKEN } })
    .then(r => r.json())
    .then(d => { if (d.user) enterApp(); else logout(); })
    .catch(() => {});
}
