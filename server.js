/**
 * 闲鱼自动分销 SaaS 系统（一期 V1.0）
 * 零依赖 Node.js HTTP 服务：REST API + 静态前端 + 闲管家模拟对接层 + 业务模拟引擎
 *
 * 模块映射（对应 PRD）：
 *  M1 店铺管理 / M2 商品铺货 / M3 商品关联 / M4 订单管理
 *  M5 采购管理 / M6 发货管理 / M7 售后管理 / M8 数据统计
 *
 * 说明：闲管家开放平台需企业资质与正式 AppKey 才能接入，本实现内置
 * 「闲管家模拟网关」（xianGuanjia.js 逻辑内联于此），接口签名/数据结构与
 * 真实开放平台对齐，替换 baseUrl + appKey/secret 后即可切正式环境。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3788;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(ROOT, 'public');

/* ============================ 工具函数 ============================ */
const uid = (p) => p + '_' + crypto.randomBytes(6).toString('hex');
// 部署级固定密钥：云端多实例/重启均可验证同一 token（生产环境建议用环境变量覆盖）
const APP_SECRET = process.env.APP_SECRET || 'fx-saas-2026-09-18-xianyu-fenxiao-static-key';
const b64u = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
// JWT 风格 token：payload 内嵌用户信息 + HMAC 签名——验签即认证，不依赖任何实例的数据库状态
const signToken = (u) => {
  const payload = b64u({ id: u.id, username: u.username, name: u.name, role: u.role, iat: Date.now() });
  return payload + '.' + crypto.createHmac('sha256', APP_SECRET).update(payload).digest('hex').slice(0, 32);
};
const now = () => Date.now();
const fmtTs = (t) => new Date(t).toLocaleString('zh-CN', { hour12: false });
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashPwd = (pwd, salt) => sha256(salt + '::' + pwd);
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const dayMs = 86400000;

/* ============================ 数据持久化 ============================ */
let db = null;
let saveTimer = null;
function saveDb(immediate) {
  const doSave = () => {
    try {
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) { console.error('[db] save failed:', e.message); }
  };
  if (immediate) { clearTimeout(saveTimer); doSave(); return; }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 800); // 防抖落盘
}

/* ============================ 闲管家模拟网关 ============================ */
/**
 * 模拟闲管家开放平台（xgj）：店铺信息、商品发布、订单列表、物流回传等。
 * 真实接入时：将下方方法替换为对 https://open.xianguanjia.com 的 HTTP 调用，
 * 并用 appKey/secret 做 HMAC 签名。
 */
const xgj = {
  // 店铺授权：返回授权 token 与店铺信息
  authorize(mobile) {
    const nick = '闲鱼店' + mobile.slice(-4);
    return {
      ok: true,
      token: 'xgj_tok_' + crypto.randomBytes(10).toString('hex'),
      expireAt: now() + 90 * dayMs,
      shop: {
        name: nick + '的店',
        avatar: '',
        score: (4.6 + Math.random() * 0.4).toFixed(1),
      },
    };
  },
  // 商品发布到闲鱼
  publishProduct(storeToken, product) {
    if (!storeToken) return { ok: false, code: 'AUTH_INVALID', msg: '店铺授权失效' };
    if (/假|最便宜|第一/.test(product.title)) return { ok: false, code: 'BANNED_WORD', msg: '标题含违规词' };
    return Math.random() < 0.9
      ? { ok: true, itemId: 'xy_' + crypto.randomBytes(5).toString('hex') }
      : { ok: false, code: Math.random() < 0.5 ? 'CATEGORY_MISS' : 'IMAGE_RISK', msg: Math.random() < 0.5 ? '类目映射缺失' : '主图疑似违规' };
  },
  // 拉取闲鱼订单（模拟产生新订单）
  pullOrders(store, listings) {
    const out = [];
    const n = rint(0, 2);
    for (let i = 0; i < n; i++) {
      if (!listings.length) break;
      const li = rnd(listings);
      const qty = rint(1, 3);
      out.push({
        orderNo: 'XY' + now().toString().slice(-9) + rint(100, 999) + i,
        listingId: li.id,
        qty,
        amount: +(li.price * qty).toFixed(2),
        buyer: '闲鱼用户' + rint(1000, 9999),
        remark: Math.random() < 0.3 ? rnd(['尽快发货', '请保密发货', '送人，包装好一点', '']) : '',
        createdAt: now() - rint(0, 30) * 60000,
      });
    }
    return out;
  },
  // 物流回传到闲鱼
  pushLogistics(storeToken, orderNo, shipNo, company) {
    return { ok: !!storeToken, orderNo };
  },
};

/* ============================ 种子数据 ============================ */
const CATEGORIES = ['3C数码配件', '服饰鞋包', '家居日用', '美妆个护', '玩具乐器', '运动户外', '图书文具', '食品生鲜'];
const GOODS_TITLES = [
  '无线蓝牙耳机 半入耳式 超长续航', '手机壳 硅胶防摔 全包边', '快充数据线 Type-C 100W', '运动蓝牙音箱 户外便携',
  '男士休闲夹衫 春秋新款', '女士单肩包 大容量 斜挎', '小白鞋 百搭板鞋 情侣款', '儿童积木玩具 益智拼装',
  '不锈钢保温杯 500ml 大容量', '收纳盒 抽屉式 塑料整理箱', '香薰蜡烛 助眠礼盒装', '电动牙刷 软毛 成人款',
  '瑜伽垫 加厚防滑 初学者', '羽毛球拍 双拍套装', '笔记本 B5 加厚车线本', '中性笔 0.5 黑色 20支装',
  '车载手机支架 重力感应', '便携榨汁杯 USB充电', 'LED化妆镜 带灯台式', '厨房置物架 落地多层',
  '钓鱼竿套装 远投海竿', '露营收纳箱 户外折叠', '素描铅笔套装 专业美术', '水彩颜料 24色 便携装',
  '猫抓板 瓦楞纸大号', '狗狗牵引绳 自动伸缩', '加绒卫衣 宽松显瘦', '牛仔裤 直筒宽松 男款',
  '蓝牙键盘 无线静音 平板通用', '手机支架桌面 折叠升降', '防晒帽 遮阳大檐 可折叠', '压缩毛巾 一次性 旅行装',
];
function seedGoods() {
  const goods = [];
  for (let i = 0; i < 40; i++) {
    const price = +(rint(8, 260) + Math.random()).toFixed(2);
    goods.push({
      id: 'g' + String(i + 1).padStart(3, '0'),
      source: '1688',
      title: GOODS_TITLES[i % GOODS_TITLES.length] + (i >= GOODS_TITLES.length ? ' 升级款' : ''),
      category: CATEGORIES[i % CATEGORIES.length],
      price,
      shipPrice: Math.random() < 0.7 ? 0 : rint(3, 12), // 包邮概率
      stock: rint(50, 5000),
      supplier: rnd(['义乌市鼎盛百货', '广州优品数码厂', '汕头潮玩制品', '临沂日化供应链', '苏州服饰源头厂']),
      shipTime: rnd(['24小时内', '48小时内']),
      specs: [
        { name: '默认规格', price },
        { name: '升级版', price: +(price * 1.3).toFixed(2) },
      ],
      images: [],
      listedAt: now() - rint(1, 60) * dayMs,
    });
  }
  return goods;
}

function seed() {
  // 云端沙箱可能多副本各自播种：用户/店铺 ID 必须固定，否则跨副本 token 认证失败
  const mkUser = (id, username, pwd, role, name) => {
    const salt = crypto.randomBytes(6).toString('hex');
    return { id, username, salt, pwdHash: hashPwd(pwd, salt), role, name, createdAt: now() - 30 * dayMs };
  };
  const users = [
    mkUser('u_admin', 'admin', 'admin123', 'super_admin', '平台管理员'),
    mkUser('u_shop', 'shop', 'shop123', 'store_admin', '店铺管理员'),
    mkUser('u_ops', 'ops', 'ops123', 'operator', '运营专员'),
  ];
  const owner = users[1];
  const stores = [];
  ['st_shop1', 'st_shop2'].forEach((sid, i) => {
    const a = xgj.authorize('138' + String(rint(10000000, 99999999)));
    stores.push({
      id: sid, ownerId: owner.id, name: a.shop.name, avatar: '', score: a.shop.score,
      platform: 'xianyu', token: a.token, authStatus: 'valid', authExpireAt: a.expireAt,
      markupRate: 1.4, freight: 0, publishMode: 'auto', freightTemplate: '包邮模板',
      orderFlow: 'auto', priceStrategy: '最低价', lossFilter: true, autoRemark: '请保密发货',
      shipTiming: '有物流单号即发货', bindAt: now() - 20 * dayMs,
    });
  });
  const goods = seedGoods();
  const listings = [];
  const orders = [];
  const purchases = [];
  const aftersales = [];
  const tasks = [];
  const notifications = [];
  const logs = [];
  // 初始铺货：每店 8 个商品
  stores.forEach((st, si) => {
    for (let i = 0; i < 8; i++) {
      const g = goods[(si * 8 + i) % goods.length];
      listings.push({
        id: uid('li'), storeId: st.id, goodsId: i < 6 ? g.id : null,
        title: g.title, image: '', goodsPrice: g.price,
        price: +(g.price * st.markupRate + st.freight).toFixed(2),
        status: i === 7 ? 'draft' : 'on', stock: g.stock,
        publishAt: now() - rint(1, 15) * dayMs, xyItemId: 'xy_' + crypto.randomBytes(4).toString('hex'),
      });
    }
  });
  // 历史订单（近14天，含各状态）
  const linkedListings = listings.filter(l => l.goodsId);
  for (let d = 13; d >= 0; d--) {
    const n = rint(1, 4);
    for (let i = 0; i < n; i++) {
      const li = rnd(linkedListings);
      const g = goods.find(x => x.id === li.goodsId);
      const qty = rint(1, 2);
      const amount = +(li.price * qty).toFixed(2);
      const cost = +(g.price * qty).toFixed(2);
      const done = d > 2;
      const o = {
        id: uid('o'), orderNo: 'XY' + (now() - d * dayMs).toString().slice(-9) + rint(100, 999),
        storeId: li.storeId, listingId: li.id, title: li.title, qty, buyer: '闲鱼用户' + rint(1000, 9999),
        amount, cost, linked: true, remark: '',
        status: done ? '已完成' : rnd(['待付款', '待发货', '待收货']),
        createdAt: now() - d * dayMs - rint(0, 20) * 3600000,
        doneAt: done ? now() - d * dayMs + 2 * dayMs : null,
      };
      o.profit = +(amount - cost - (Math.random() < 0.2 ? 5 : 0)).toFixed(2);
      orders.push(o);
      if (o.status !== '待采购') {
        purchases.push({
          id: uid('p'), orderNos: [o.orderNo], storeId: o.storeId, supplier: rnd(['义乌市鼎盛百货', '广州优品数码厂']),
          goodsTitle: o.title, qty: o.qty, amount: o.cost, status: o.status === '已完成' ? '已完成' : o.status === '待收货' ? '待收货' : '待发货',
          address: rnd(['浙江省杭州市西湖区XX路8号', '广东省深圳市南山区YY街12号']), shipNo: o.status === '已完成' || o.status === '待收货' ? 'SF' + rint(100000000, 999999999) : null,
          logistics: '顺丰速运', payAt: now() - d * dayMs, remark: '请保密发货', createdAt: o.createdAt,
        });
      }
    }
  }
  // 未关联订单 2 条
  const unlinkLi = listings.find(l => !l.goodsId);
  if (unlinkLi) {
    for (let i = 0; i < 2; i++) {
      orders.push({
        id: uid('o'), orderNo: 'XY' + now().toString().slice(-8) + rint(10, 99) + i, storeId: unlinkLi.storeId,
        listingId: unlinkLi.id, title: unlinkLi.title, qty: 1, buyer: '闲鱼用户' + rint(1000, 9999),
        amount: unlinkLi.price, cost: 0, linked: false, remark: '', status: '待采购',
        createdAt: now() - rint(1, 3) * dayMs,
      });
    }
  }
  // 一条售后单
  const doneOrder = orders.find(o => o.status === '已完成');
  if (doneOrder) {
    aftersales.push({
      id: uid('af'), orderNo: doneOrder.orderNo, storeId: doneOrder.storeId, type: '仅退款',
      reason: rnd(['商品与描述不符', '运输破损', '不想要了']), amount: doneOrder.amount, status: '已同步供应商',
      createdAt: now() - dayMs, timeline: [{ at: now() - dayMs, text: '闲鱼买家发起售后' }, { at: now() - dayMs + 3600000, text: '已自动向供应商发起售后' }],
    });
  }
  return {
    users, sessions: {}, stores, goods, listings, orders, purchases, aftersales,
    tasks, notifications: notifications, logs, payments: [],
    seq: 1,
  };
}

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      // 兼容缺字段
      ['payments', 'logs', 'notifications', 'tasks', 'sessions'].forEach(k => { if (!db[k]) db[k] = []; });
      if (!db.seq) db.seq = 1;
      return;
    }
  } catch (e) { console.error('[db] load failed, reseeding:', e.message); }
  db = seed();
  saveDb(true);
}

/* ============================ 业务辅助 ============================ */
function addLog(user, action, detail) {
  db.logs.unshift({ id: uid('lg'), at: now(), user: user ? user.name : 'system', action, detail: detail || '' });
  if (db.logs.length > 500) db.logs.length = 500;
  saveDb();
}
function notify(type, text) {
  db.notifications.unshift({ id: uid('nt'), type, text, read: false, at: now() });
  if (db.notifications.length > 200) db.notifications.length = 200;
  saveDb();
}
function getGoods(id) { return db.goods.find(g => g.id === id); }
function getStore(id) { return db.stores.find(s => s.id === id); }
function storeView(st) {
  return {
    ...st, token: undefined,
    productsCount: db.listings.filter(l => l.storeId === st.id).length,
    ordersCount: db.orders.filter(o => o.storeId === st.id).length,
    authExpireDays: Math.max(0, Math.ceil((st.authExpireAt - now()) / dayMs)),
  };
}
// 生成采购单（订单 → 采购）
function createPurchaseForOrder(o, user) {
  const li = db.listings.find(l => l.id === o.listingId);
  const g = li && li.goodsId ? getGoods(li.goodsId) : null;
  if (!g) { o.linked = false; return null; }
  o.cost = +(g.price * o.qty).toFixed(2);
  o.profit = +(o.amount - o.cost).toFixed(2);
  const st = getStore(o.storeId);
  if (st.lossFilter && o.profit <= 0) {
    o.status = '已关闭'; o.remark = '亏损单自动过滤';
    notify('order', `订单 ${o.orderNo} 预估利润 ≤0，已被亏损单过滤`);
    return null;
  }
  const p = {
    id: uid('p'), orderNos: [o.orderNo], storeId: o.storeId, supplier: g.supplier,
    goodsTitle: o.title, qty: o.qty, amount: o.cost, status: '待付款',
    address: rnd(['浙江省杭州市西湖区文一路 8 号', '广东省深圳市南山区科技园 12 号', '上海市浦东新区张江路 66 号']),
    shipNo: null, logistics: null, payAt: null, remark: st.autoRemark || '', createdAt: now(),
  };
  db.purchases.unshift(p);
  o.status = '待付款'; o.purchaseId = p.id;
  notify('purchase', `订单 ${o.orderNo} 已生成采购单，待付款 ¥${p.amount}`);
  return p;
}
// 采购付款 → 发货 → 收货 全链路推进
function payPurchases(ids, user, merge) {
  const list = db.purchases.filter(p => ids.includes(p.id) && p.status === '待付款');
  if (!list.length) return { error: '没有可付款的采购单' };
  const total = +list.reduce((s, p) => s + p.amount, 0).toFixed(2);
  const pay = {
    id: uid('pay'), ids: list.map(p => p.id), orderNos: list.flatMap(p => p.orderNos),
    amount: total, merged: !!merge, channel: merge ? '合单支付' : (list.length > 1 ? '批量支付' : '单笔支付'),
    at: now(), operator: user.name,
  };
  db.payments.unshift(pay);
  list.forEach(p => {
    p.status = '待发货'; p.payAt = now();
    const o = db.orders.find(x => x.orderNo === p.orderNos[0]);
    if (o) o.status = '待发货';
    notify('purchase', `采购单已付款 ¥${p.amount}（${p.goodsTitle.slice(0, 12)}…），等待供应商发货`);
  });
  addLog(user, '采购付款', `${pay.channel} ¥${total}，共 ${list.length} 单`);
  saveDb(true);
  return { pay };
}
// 推进发货/收货（模拟引擎调用）
function shipPurchase(p) {
  p.status = '待收货';
  p.shipNo = 'SF' + rint(100000000, 999999999);
  p.logistics = '顺丰速运';
  const o = db.orders.find(x => x.orderNo === p.orderNos[0]);
  if (o) {
    o.status = '待收货';
    const st = getStore(o.storeId);
    if (st && st.shipTiming !== '不自动发货') {
      xgj.pushLogistics(st.token, o.orderNo, p.shipNo, p.logistics);
      notify('ship', `物流已回传闲鱼：订单 ${o.orderNo} ${p.logistics} ${p.shipNo}`);
    }
  }
}
function completePurchase(p) {
  p.status = '已完成';
  const o = db.orders.find(x => x.orderNo === p.orderNos[0]);
  if (o) {
    o.status = '已完成'; o.doneAt = now();
    o.actualProfit = +(o.amount - o.cost).toFixed(2);
  }
}

/* ============================ 模拟引擎（定时推进） ============================ */
let tick = 0;
function engineTick() {
  tick++;
  try {
    // 1) 铺货任务推进：每 tick 每任务处理 2 件
    db.tasks.filter(t => t.status === 'running').forEach(t => {
      let processed = 0;
      while (t.cursor < t.items.length && processed < 5) { // 5件/4秒 ≈ 75件/分钟（PRD 要求 ≥50件/分钟）
        const item = t.items[t.cursor];
        const g = getGoods(item.goodsId);
        const st = getStore(item.storeId);
        if (g && st) {
          if (g.stock <= 0) {
            item.ok = false; item.reason = '货源缺货';
            db.listings.push({ id: uid('li'), storeId: st.id, goodsId: g.id, title: g.title, image: '', goodsPrice: g.price, price: +(g.price * st.markupRate + st.freight).toFixed(2), status: 'out_of_stock', stock: 0, publishAt: now(), xyItemId: null });
          } else {
            const r = xgj.publishProduct(st.token, { title: g.title });
            if (r.ok) {
              item.ok = true;
              db.listings.push({ id: uid('li'), storeId: st.id, goodsId: g.id, title: g.title, image: '', goodsPrice: g.price, price: +(g.price * st.markupRate + st.freight).toFixed(2), status: st.publishMode === 'auto' ? 'on' : 'draft', stock: g.stock, publishAt: now(), xyItemId: r.itemId });
            } else {
              item.ok = false; item.reason = r.msg + '（' + r.code + '）';
            }
          }
        } else { item.ok = false; item.reason = '数据异常'; }
        t.cursor++; t.done++; processed++;
      }
      if (t.cursor >= t.items.length) {
        t.status = 'done'; t.finishedAt = now();
        const fail = t.items.filter(i => i.ok === false).length;
        notify('publish', `铺货任务完成：成功 ${t.done - fail} 件，失败 ${fail} 件`);
      }
      saveDb();
    });
    // 2) 订单自动回流（实时自动回流模式店铺，~30% 概率）
    db.stores.filter(s => s.authStatus === 'valid' && s.orderFlow === 'auto').forEach(st => {
      if (Math.random() < 0.3) {
        const ls = db.listings.filter(l => l.storeId === st.id && (l.status === 'on' || l.status === 'out_of_stock'));
        const newOrders = xgj.pullOrders(st, ls);
        newOrders.forEach(no => {
          const li = db.listings.find(l => l.id === no.listingId);
          if (!li) return;
          const o = {
            id: uid('o'), orderNo: no.orderNo, storeId: st.id, listingId: li.id, title: li.title,
            qty: no.qty, buyer: no.buyer, amount: no.amount, cost: 0, linked: !!li.goodsId,
            remark: no.remark || '', status: '待采购', createdAt: no.createdAt,
          };
          db.orders.unshift(o);
          if (o.linked) { createPurchaseForOrder(o, null); }
          else notify('order', `新订单 ${o.orderNo} 未关联货源，需手动处理`);
        });
        if (newOrders.length) saveDb();
      }
    });
    // 3) 已付款采购单推进：待发货 -> 待收货 -> 已完成
    db.purchases.filter(p => p.status === '待发货' && p.payAt && now() - p.payAt > 8000).forEach(p => { if (Math.random() < 0.5) shipPurchase(p); });
    db.purchases.filter(p => p.status === '待收货' && p.payAt && now() - p.payAt > 25000).forEach(p => { if (Math.random() < 0.4) completePurchase(p); });
    // 4) 售后模拟：已完成订单小概率产生售后
    if (tick % 7 === 0) {
      const done = db.orders.filter(o => o.status === '已完成');
      if (done.length && Math.random() < 0.4) {
        const o = rnd(done);
        if (!db.aftersales.find(a => a.orderNo === o.orderNo && a.status !== '已完成')) {
          const af = {
            id: uid('af'), orderNo: o.orderNo, storeId: o.storeId, type: rnd(['仅退款', '退货退款']),
            reason: rnd(['商品与描述不符', '运输破损', '七天无理由']), amount: o.amount, status: '已同步供应商',
            createdAt: now(), timeline: [{ at: now(), text: '闲鱼买家发起售后' }, { at: now(), text: '系统已自动向供应商发起售后' }],
          };
          o.status = '售后中';
          db.aftersales.unshift(af);
          notify('aftersale', `订单 ${o.orderNo} 产生售后（${af.reason}），已自动同步供应商`);
        }
      }
    }
    // 5) 售后进度推进
    db.aftersales.filter(a => a.status === '已同步供应商' && now() - a.createdAt > 20000).forEach(a => {
      if (Math.random() < 0.4) {
        a.status = '退款成功'; a.timeline.push({ at: now(), text: '供应商同意退款，资金已原路退回' });
        const o = db.orders.find(x => x.orderNo === a.orderNo);
        if (o) { o.status = '已关闭'; o.profit = +(0 - (o.cost || 0)).toFixed(2); }
        notify('aftersale', `售后单 ${a.orderNo} 退款成功`);
      }
    });
    // 6) 授权过期随机提醒（P1：授权状态检测）
    if (tick % 15 === 0) {
      db.stores.forEach(st => {
        if (st.authStatus === 'valid' && Math.random() < 0.03) {
          st.authStatus = 'expired';
          notify('auth', `店铺「${st.name}」授权已过期，请重新授权`);
          addLog(null, '授权监控', `${st.name} 授权失效`);
        }
      });
    }
  } catch (e) { console.error('[engine]', e); }
}

/* ============================ HTTP 基础 ============================ */
function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); } });
  });
}
function auth(req) {
  // token 四通道：x-fx-token 自定义头（平台网关会篡改 Authorization，禁用）→ Cookie → ?tk= 查询参数
  let tk = req.headers['x-fx-token'] || '';
  if (!tk) {
    const m = (req.headers['cookie'] || '').match(/(?:^|;\s*)fx_token=([^;]+)/);
    if (m) tk = m[1];
  }
  if (!tk) tk = req.url.match(/[?&]tk=([^&]+)/)?.[1] || '';
  if (!tk) return null;
  // JWT 风格：验签通过直接信任 payload 中的用户信息（多副本/旧库均可用）
  if (tk.includes('.')) {
    const [payload, sig] = tk.split('.');
    if (!payload || !sig) return null;
    if (sig !== crypto.createHmac('sha256', APP_SECRET).update(payload).digest('hex').slice(0, 32)) return null;
    try {
      const u = JSON.parse(Buffer.from(payload, 'base64url').toString());
      return { id: u.id, username: u.username, name: u.name, role: u.role };
    } catch { return null; }
  }
  // 兼容旧格式：内存 session / 固定用户 ID
  const uidStr = db.sessions[tk] || tk;
  return db.users.find(x => x.id === uidStr) || null;
}
const can = (u, perm) => {
  if (!u) return false;
  if (u.role === 'super_admin') return true;
  if (u.role === 'store_admin') return perm !== 'user_manage';
  return ['view', 'order_view', 'stats_view'].includes(perm); // 运营人员：只读受限
};
const isReadOp = (method) => method === 'GET';

/* ============================ API 路由 ============================ */
async function route(req, res) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const q = Object.fromEntries(u.searchParams);
  const method = req.method;
  const user = auth(req);

  /* ---- 静态文件 ---- */
  if (method === 'GET' && !p.startsWith('/api/')) {
    let fp = p === '/' ? '/index.html' : p;
    fp = path.normalize(fp).replace(/^(\.\.[/\\])+/, '');
    const abs = path.join(PUBLIC_DIR, fp);
    if (!abs.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'forbidden' });
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      const ext = path.extname(abs);
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
      return res.end(fs.readFileSync(abs));
    }
    return json(res, 404, { error: 'not found' });
  }

  /* ---- 认证 ---- */
  if (p === '/api/login' && method === 'POST') {
    const b = await readBody(req);
    const usr = db.users.find(x => x.username === b.username);
    if (!usr || usr.pwdHash !== hashPwd(b.password || '', usr.salt)) return json(res, 401, { error: '用户名或密码错误' });
    const tk = signToken(usr);
    db.sessions[tk] = usr.id;
    addLog(usr, '登录', `用户 ${usr.username} 登录系统`);
    saveDb(true);
    // 同时下发 HttpOnly Cookie 兜底（防反代剥离 Authorization 头）
    res.setHeader('Set-Cookie', `fx_token=${tk}; Path=/; Max-Age=604800; SameSite=Lax`);
    return json(res, 200, { token: tk, user: { id: usr.id, username: usr.username, name: usr.name, role: usr.role } });
  }
  if (p === '/api/me' && method === 'GET') {
    if (!user) return json(res, 401, { error: '未登录' });
    return json(res, 200, { user: { id: user.id, username: user.username, name: user.name, role: user.role } });
  }
  if (p === '/api/logout' && method === 'POST') {
    const tk = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    delete db.sessions[tk];
    saveDb(true);
    return json(res, 200, { ok: true });
  }

  if (!p.startsWith('/api/')) return json(res, 404, { error: 'not found' });
  if (!user) return json(res, 401, { error: '未登录' });
  // 写操作权限：运营人员只读
  if (!isReadOp(method) && !can(user, 'manage')) return json(res, 403, { error: '当前角色为「运营人员」，仅有查看权限' });

  const body = method === 'POST' || method === 'PUT' ? await readBody(req) : {};

  /* ---- M1 店铺管理 ---- */
  if (p === '/api/stores' && method === 'GET') {
    let list = user.role === 'super_admin' ? db.stores : db.stores.filter(s => s.ownerId === user.id);
    // 兼容云端旧数据副本（ownerId 为历史随机 ID）：店管本人无店铺时展示全部
    if (user.role === 'store_admin' && list.length === 0) list = db.stores;
    if (q.keyword) list = list.filter(s => s.name.includes(q.keyword));
    if (q.status) list = list.filter(s => s.authStatus === q.status);
    return json(res, 200, { list: list.map(storeView) });
  }
  if (p === '/api/stores/bind' && method === 'POST') {
    // 模拟闲管家五步授权绑定
    const mobile = body.mobile || '138' + String(rint(10000000, 99999999));
    const a = xgj.authorize(mobile);
    const st = {
      id: uid('st'), ownerId: user.id, name: a.shop.name, avatar: '', score: a.shop.score,
      platform: 'xianyu', token: a.token, authStatus: 'valid', authExpireAt: a.expireAt,
      markupRate: 1.4, freight: 0, publishMode: 'auto', freightTemplate: '包邮模板',
      orderFlow: 'auto', priceStrategy: '最低价', lossFilter: true, autoRemark: '请保密发货',
      shipTiming: '有物流单号即发货', bindAt: now(), mobile,
    };
    db.stores.push(st);
    notify('store', `店铺「${st.name}」绑定成功，授权有效期 90 天`);
    addLog(user, '绑定店铺', st.name);
    saveDb(true);
    return json(res, 200, { store: storeView(st) });
  }
  let m = p.match(/^\/api\/stores\/([\w-]+)(\/[\w-]+)?$/);
  if (m) {
    const st = getStore(m[1]);
    if (!st) return json(res, 404, { error: '店铺不存在' });
    if (m[2] === '/unbind' && method === 'POST') {
      db.stores = db.stores.filter(s => s.id !== st.id);
      db.listings = db.listings.filter(l => l.storeId !== st.id);
      addLog(user, '解绑店铺', st.name);
      saveDb(true);
      return json(res, 200, { ok: true });
    }
    if (m[2] === '/sync' && method === 'POST') {
      // 从闲鱼同步店铺信息
      st.score = (4.5 + Math.random() * 0.5).toFixed(1);
      addLog(user, '同步店铺', st.name);
      saveDb(true);
      return json(res, 200, { store: storeView(st) });
    }
    if (m[2] === '/settings' && method === 'PUT') {
      Object.assign(st, {
        markupRate: body.markupRate ?? st.markupRate,
        freight: body.freight ?? st.freight,
        publishMode: body.publishMode ?? st.publishMode,
        freightTemplate: body.freightTemplate ?? st.freightTemplate,
        orderFlow: body.orderFlow ?? st.orderFlow,
        priceStrategy: body.priceStrategy ?? st.priceStrategy,
        lossFilter: body.lossFilter ?? st.lossFilter,
        autoRemark: body.autoRemark ?? st.autoRemark,
        shipTiming: body.shipTiming ?? st.shipTiming,
      });
      addLog(user, '修改店铺设置', st.name);
      saveDb(true);
      return json(res, 200, { store: storeView(st) });
    }
    if (!m[2] && method === 'GET') return json(res, 200, { store: storeView(st) });
  }

  /* ---- M2 货源商品库 ---- */
  if (p === '/api/goods' && method === 'GET') {
    let list = db.goods.slice();
    if (q.keyword) list = list.filter(g => g.title.includes(q.keyword) || g.supplier.includes(q.keyword));
    if (q.category) list = list.filter(g => g.category === q.category);
    if (q.min) list = list.filter(g => g.price >= +q.min);
    if (q.max) list = list.filter(g => g.price <= +q.max);
    list.sort((a, b) => b.listedAt - a.listedAt);
    const page = +(q.page || 1), size = +(q.size || 12);
    return json(res, 200, {
      total: list.length, page,
      list: list.slice((page - 1) * size, page * size),
      categories: CATEGORIES,
    });
  }
  m = p.match(/^\/api\/goods\/([\w-]+)$/);
  if (m && method === 'GET') {
    const g = getGoods(m[1]);
    return g ? json(res, 200, { goods: g }) : json(res, 404, { error: '货源不存在' });
  }

  /* ---- M2 铺货任务 ---- */
  if (p === '/api/publish-tasks' && method === 'POST') {
    const goodsIds = body.goodsIds || [];
    const storeIds = body.storeIds || [];
    if (!goodsIds.length || !storeIds.length) return json(res, 400, { error: '请选择货源商品和目标店铺' });
    const items = [];
    storeIds.forEach(sid => goodsIds.forEach(gid => items.push({ goodsId: gid, storeId: sid, ok: null, reason: '' })));
    const t = { id: uid('t'), storeIds, goodsIds, items, cursor: 0, done: 0, total: items.length, status: 'running', createdAt: now(), finishedAt: null, creator: user.name };
    db.tasks.unshift(t);
    addLog(user, '创建铺货任务', `${goodsIds.length} 件商品 → ${storeIds.length} 家店铺`);
    saveDb(true);
    return json(res, 200, { task: t });
  }
  if (p === '/api/publish-tasks' && method === 'GET') {
    let list = db.tasks;
    if (q.status === 'running') list = list.filter(t => t.status === 'running');
    else if (q.status === 'done') list = list.filter(t => t.status === 'done');
    return json(res, 200, { list: list.slice(0, 50) });
  }
  m = p.match(/^\/api\/publish-tasks\/([\w-]+)\/retry$/);
  if (m && method === 'POST') {
    const t = db.tasks.find(x => x.id === m[1]);
    if (!t) return json(res, 404, { error: '任务不存在' });
    const failedItems = t.items.filter(i => i.ok === false);
    if (!failedItems.length) return json(res, 400, { error: '没有失败的铺货项' });
    const nt = { id: uid('t'), storeIds: t.storeIds, goodsIds: failedItems.map(i => i.goodsId), items: failedItems.map(i => ({ ...i, ok: null, reason: '' })), cursor: 0, done: 0, total: failedItems.length, status: 'running', createdAt: now(), finishedAt: null, creator: user.name, retryOf: t.id };
    db.tasks.unshift(nt);
    saveDb(true);
    return json(res, 200, { task: nt });
  }
  // 铺货管理四态列表（成功/失败/铺货中/缺货 由 listings + tasks 聚合）
  if (p === '/api/publish/results' && method === 'GET') {
    const st0 = q.storeId || '';
    let listings = db.listings.slice();
    if (st0) listings = listings.filter(l => l.storeId === st0);
    const success = listings.filter(l => l.status === 'on' || l.status === 'draft');
    const oos = listings.filter(l => l.status === 'out_of_stock');
    let failItems = [];
    db.tasks.forEach(t => t.items.forEach(i => { if (i.ok === false) failItems.push({ ...i, task: t.id, at: t.createdAt }); }));
    if (st0) failItems = failItems.filter(i => i.storeId === st0);
    const running = db.tasks.filter(t => t.status === 'running');
    const enrich = (l) => ({ ...l, storeName: (getStore(l.storeId) || {}).name, goods: l.goodsId ? getGoods(l.goodsId) : null });
    return json(res, 200, {
      success: success.map(enrich), oos: oos.map(enrich), fail: failItems,
      running: running.map(t => ({ id: t.id, total: t.total, done: t.done, createdAt: t.createdAt, percent: Math.round(t.done / t.total * 100) })),
    });
  }

  /* ---- M2/M3 闲鱼商品（铺货商品 + 关联） ---- */
  if (p === '/api/listings' && method === 'GET') {
    let list = db.listings.slice();
    if (q.storeId) list = list.filter(l => l.storeId === q.storeId);
    if (q.keyword) list = list.filter(l => l.title.includes(q.keyword));
    if (q.linked === 'no') list = list.filter(l => !l.goodsId);
    if (q.status) list = list.filter(l => l.status === q.status);
    list.sort((a, b) => b.publishAt - a.publishAt);
    return json(res, 200, {
      list: list.map(l => ({ ...l, storeName: (getStore(l.storeId) || {}).name, goods: l.goodsId ? getGoods(l.goodsId) : null })),
      unlinkedCount: db.listings.filter(l => !l.goodsId).length,
    });
  }
  m = p.match(/^\/api\/listings\/([\w-]+)(\/[\w-]+)?$/);
  if (m) {
    const li = db.listings.find(l => l.id === m[1]);
    if (!li) return json(res, 404, { error: '商品不存在' });
    if (m[2] === '/link' && method === 'POST') {
      const g = getGoods(body.goodsId);
      if (!g) return json(res, 400, { error: '货源不存在' });
      li.goodsId = g.id; li.goodsPrice = g.price;
      addLog(user, '关联货源', `${li.title} → ${g.title}`);
      saveDb(true);
      return json(res, 200, { ok: true });
    }
    if (m[2] === '/link' && method === 'DELETE') {
      li.goodsId = null;
      addLog(user, '解除关联', li.title);
      saveDb(true);
      return json(res, 200, { ok: true });
    }
    if (m[2] === '/shelf' && method === 'POST') {
      li.status = body.on ? 'on' : 'off';
      saveDb(true);
      return json(res, 200, { ok: true });
    }
    if (m[2] === '/update' && method === 'POST') {
      const g = li.goodsId && getGoods(li.goodsId);
      if (!g) return json(res, 400, { error: '未关联货源，无法同步更新' });
      const st = getStore(li.storeId);
      li.goodsPrice = g.price;
      li.price = +(g.price * (st ? st.markupRate : 1.4) + (st ? st.freight : 0)).toFixed(2);
      li.stock = g.stock;
      li.title = g.title;
      addLog(user, '同步货源更新', li.title);
      saveDb(true);
      return json(res, 200, { listing: li });
    }
    if (m[2] === '/batch-delete' && method === 'POST') {
      db.listings = db.listings.filter(l => l.id !== li.id);
      addLog(user, '删除铺货商品', li.title);
      saveDb(true);
      return json(res, 200, { ok: true });
    }
  }
  if (p === '/api/listings/batch' && method === 'POST') {
    const ids = body.ids || [];
    const act = body.action;
    let n = 0;
    db.listings.forEach(l => {
      if (!ids.includes(l.id)) return;
      if (act === 'on' || act === 'off') { l.status = act === 'on' ? 'on' : 'off'; n++; }
      if (act === 'delete') { db.listings = db.listings.filter(x => x.id !== l.id); n++; }
      if (act === 'update') {
        const g = l.goodsId && getGoods(l.goodsId);
        if (g) { const st = getStore(l.storeId); l.price = +(g.price * (st ? st.markupRate : 1.4) + (st ? st.freight : 0)).toFixed(2); l.stock = g.stock; n++; }
      }
    });
    addLog(user, '批量操作', `${act} ${n} 件商品`);
    saveDb(true);
    return json(res, 200, { ok: true, count: n });
  }

  /* ---- M4 订单管理 ---- */
  if (p === '/api/orders' && method === 'GET') {
    let list = db.orders.slice();
    if (q.status) list = list.filter(o => o.status === q.status);
    if (q.storeId) list = list.filter(o => o.storeId === q.storeId);
    if (q.keyword) list = list.filter(o => o.orderNo.includes(q.keyword) || o.title.includes(q.keyword) || o.buyer.includes(q.keyword));
    if (q.linked === 'no') list = list.filter(o => !o.linked);
    if (q.abnormal === '1') list = list.filter(o => !o.linked || (o.purchaseId && !db.purchases.find(x => x.id === o.purchaseId)));
    list.sort((a, b) => b.createdAt - a.createdAt);
    return json(res, 200, {
      list: list.slice(0, 200).map(o => ({ ...o, storeName: (getStore(o.storeId) || {}).name })),
      counts: {
        all: db.orders.length,
        待采购: db.orders.filter(o => o.status === '待采购').length,
        待付款: db.orders.filter(o => o.status === '待付款').length,
        待发货: db.orders.filter(o => o.status === '待发货').length,
        待收货: db.orders.filter(o => o.status === '待收货').length,
        售后中: db.orders.filter(o => o.status === '售后中').length,
        已完成: db.orders.filter(o => o.status === '已完成').length,
        unlinked: db.orders.filter(o => !o.linked && o.status !== '已关闭').length,
      },
    });
  }
  if (p === '/api/orders/pull' && method === 'POST') {
    // 手动批量回流：拉取最近 3 天订单
    const st = getStore(body.storeId);
    if (!st) return json(res, 400, { error: '请选择店铺' });
    const ls = db.listings.filter(l => l.storeId === st.id);
    const newOrders = xgj.pullOrders(st, ls);
    newOrders.forEach(no => {
      const li = db.listings.find(l => l.id === no.listingId);
      if (!li) return;
      const o = {
        id: uid('o'), orderNo: no.orderNo + 'M', storeId: st.id, listingId: li.id, title: li.title,
        qty: no.qty, buyer: no.buyer, amount: no.amount, cost: 0, linked: !!li.goodsId,
        remark: no.remark || '', status: '待采购', createdAt: now(), manual: true,
      };
      db.orders.unshift(o);
      if (o.linked) createPurchaseForOrder(o, user);
    });
    addLog(user, '手动回流订单', `${st.name} 拉取 ${newOrders.length} 笔`);
    saveDb(true);
    return json(res, 200, { pulled: newOrders.length });
  }
  m = p.match(/^\/api\/orders\/([\w-]+)(\/[\w-]+)?$/);
  if (m) {
    const o = db.orders.find(x => x.id === m[1]);
    if (!o) return json(res, 404, { error: '订单不存在' });
    if (!m[2] && method === 'GET') {
      return json(res, 200, {
        order: { ...o, storeName: (getStore(o.storeId) || {}).name },
        listing: db.listings.find(l => l.id === o.listingId) || null,
        goods: (db.listings.find(l => l.id === o.listingId) || {}).goodsId ? getGoods(db.listings.find(l => l.id === o.listingId).goodsId) : null,
        purchase: o.purchaseId ? db.purchases.find(x => x.id === o.purchaseId) : null,
        aftersale: db.aftersales.find(a => a.orderNo === o.orderNo) || null,
      });
    }
    if (m[2] === '/confirm-purchase' && method === 'POST') {
      if (o.linked) {
        const created = createPurchaseForOrder(o, user);
        saveDb(true);
        return created ? json(res, 200, { ok: true, purchase: created }) : json(res, 400, { error: '订单已被亏损单过滤或状态异常' });
      }
      return json(res, 400, { error: '该订单未关联货源，请先在「商品关联」中绑定货源' });
    }
    if (m[2] === '/cancel' && method === 'POST') {
      o.status = '已关闭';
      if (o.purchaseId) { const pu = db.purchases.find(x => x.id === o.purchaseId); if (pu && pu.status === '待付款') pu.status = '已关闭'; }
      addLog(user, '取消订单', o.orderNo);
      saveDb(true);
      return json(res, 200, { ok: true });
    }
  }

  /* ---- M5 采购管理 ---- */
  if (p === '/api/purchases' && method === 'GET') {
    let list = db.purchases.slice();
    if (q.status) list = list.filter(x => x.status === q.status);
    if (q.storeId) list = list.filter(x => x.storeId === q.storeId);
    if (q.keyword) list = list.filter(x => x.goodsTitle.includes(q.keyword) || x.supplier.includes(q.keyword) || x.orderNos.some(n => n.includes(q.keyword)));
    list.sort((a, b) => b.createdAt - a.createdAt);
    return json(res, 200, {
      list: list.slice(0, 200).map(x => ({ ...x, storeName: (getStore(x.storeId) || {}).name })),
      counts: {
        待付款: db.purchases.filter(x => x.status === '待付款').length,
        待发货: db.purchases.filter(x => x.status === '待发货').length,
        待收货: db.purchases.filter(x => x.status === '待收货').length,
        已完成: db.purchases.filter(x => x.status === '已完成').length,
      },
    });
  }
  if (p === '/api/purchases/pay' && method === 'POST') {
    const r = payPurchases(body.ids || [], user, false);
    return r.error ? json(res, 400, { error: r.error }) : json(res, 200, r);
  }
  if (p === '/api/purchases/merge-pay' && method === 'POST') {
    const ids = body.ids || [];
    const ps = db.purchases.filter(x => ids.includes(x.id) && x.status === '待付款');
    if (ps.length < 2) return json(res, 400, { error: '合单支付至少需要 2 笔待付款采购单' });
    const suppliers = new Set(ps.map(x => x.supplier));
    const addrs = new Set(ps.map(x => x.address));
    if (suppliers.size > 1 || addrs.size > 1) return json(res, 400, { error: '仅同一供应商且同一收货地址的采购单可合单支付' });
    const r = payPurchases(ids, user, true);
    return r.error ? json(res, 400, { error: r.error }) : json(res, 200, r);
  }
  if (p === '/api/payments' && method === 'GET') return json(res, 200, { list: db.payments.slice(0, 100) });

  /* ---- M6 发货管理 ---- */
  if (p === '/api/shipping' && method === 'GET') {
    const list = db.purchases.filter(x => x.status === '待收货' || x.status === '待发货').slice(0, 100)
      .map(x => ({ ...x, storeName: (getStore(x.storeId) || {}).name }));
    return json(res, 200, { list, settings: db.stores.map(s => ({ id: s.id, name: s.name, shipTiming: s.shipTiming })) });
  }
  if (p === '/api/shipping/refresh' && method === 'POST') {
    const x = db.purchases.find(y => y.id === body.id);
    if (!x || x.status !== '待发货') return json(res, 400, { error: '仅待发货状态可刷新物流' });
    if (Math.random() < 0.6) { shipPurchase(x); saveDb(true); return json(res, 200, { ok: true, shipped: true, shipNo: x.shipNo }); }
    return json(res, 200, { ok: true, shipped: false, msg: '供应商尚未发货，请稍后再试' });
  }

  /* ---- M7 售后管理 ---- */
  if (p === '/api/aftersales' && method === 'GET') return json(res, 200, { list: db.aftersales.slice(0, 100) });
  if (p === '/api/aftersales' && method === 'POST') {
    const o = db.orders.find(x => x.orderNo === body.orderNo);
    if (!o) return json(res, 400, { error: '订单号不存在' });
    const af = {
      id: uid('af'), orderNo: o.orderNo, storeId: o.storeId, type: body.type || '仅退款',
      reason: body.reason || '手动发起', amount: o.amount, status: '已同步供应商',
      createdAt: now(), timeline: [{ at: now(), text: '手动发起售后申请' }, { at: now(), text: '已同步供应商' }],
    };
    o.status = '售后中';
    db.aftersales.unshift(af);
    addLog(user, '发起售后', af.orderNo);
    saveDb(true);
    return json(res, 200, { aftersale: af });
  }

  /* ---- M8 数据统计 ---- */
  if (p === '/api/stats' && method === 'GET') {
    const range = +(q.range || 7); // 天
    const storeId = q.storeId || '';
    const since = now() - range * dayMs;
    let orders = db.orders.filter(o => o.createdAt >= since);
    if (storeId) orders = orders.filter(o => o.storeId === storeId);
    const done = orders.filter(o => o.status === '已完成' || o.status === '已关闭');
    const sales = +orders.reduce((s, o) => s + o.amount, 0).toFixed(2);
    const purchase = +orders.reduce((s, o) => s + (o.cost || 0), 0).toFixed(2);
    const profit = +(sales - purchase).toFixed(2);
    const doneSales = +done.filter(o => o.status === '已完成').reduce((s, o) => s + o.amount, 0).toFixed(2);
    // 趋势（按天）
    const trend = [];
    for (let d = range - 1; d >= 0; d--) {
      const dayStart = new Date(new Date(now() - d * dayMs).toLocaleDateString('zh-CN', { hour12: false })).getTime();
      const dayEnd = dayStart + dayMs;
      const dos = db.orders.filter(o => o.createdAt >= dayStart && o.createdAt < dayEnd && (!storeId || o.storeId === storeId));
      trend.push({
        date: new Date(dayStart).toISOString().slice(5, 10),
        orders: dos.length,
        sales: +dos.reduce((s, o) => s + o.amount, 0).toFixed(2),
        profit: +dos.reduce((s, o) => s + (o.amount - (o.cost || 0)), 0).toFixed(2),
      });
    }
    // 分店统计
    const perStore = db.stores.map(st => {
      const os = db.orders.filter(o => o.storeId === st.id && o.createdAt >= since);
      return {
        name: st.name,
        orders: os.length,
        sales: +os.reduce((s, o) => s + o.amount, 0).toFixed(2),
        profit: +os.reduce((s, o) => s + (o.amount - (o.cost || 0)), 0).toFixed(2),
        products: db.listings.filter(l => l.storeId === st.id).length,
      };
    });
    // 待采购预估利润
    const pending = db.orders.filter(o => o.status === '待采购' && o.linked);
    const pendingProfit = +pending.reduce((s, o) => {
      const li = db.listings.find(l => l.id === o.listingId);
      const g = li && li.goodsId ? getGoods(li.goodsId) : null;
      return s + (g ? (o.amount - g.price * o.qty) : 0);
    }, 0).toFixed(2);
    return json(res, 200, {
      sales, purchase, profit, doneSales,
      orderCount: orders.length, doneCount: done.filter(o => o.status === '已完成').length,
      pendingCount: pending.length, pendingProfit,
      trend, perStore,
      storeOptions: db.stores.map(s => ({ id: s.id, name: s.name })),
    });
  }

  /* ---- 消息通知 ---- */
  if (p === '/api/notifications' && method === 'GET') return json(res, 200, { list: db.notifications.slice(0, 50), unread: db.notifications.filter(n => !n.read).length });
  if (p === '/api/notifications/read' && method === 'POST') { db.notifications.forEach(n => n.read = true); saveDb(true); return json(res, 200, { ok: true }); }

  /* ---- 用户管理（仅超级管理员） ---- */
  if (p === '/api/users') {
    if (!can(user, 'user_manage')) return json(res, 403, { error: '需要超级管理员权限' });
    if (method === 'GET') return json(res, 200, { list: db.users.map(x => ({ id: x.id, username: x.username, name: x.name, role: x.role, createdAt: x.createdAt })) });
    if (method === 'POST') {
      if (!body.username || !body.password) return json(res, 400, { error: '用户名和密码必填' });
      if (db.users.find(x => x.username === body.username)) return json(res, 400, { error: '用户名已存在' });
      const salt = crypto.randomBytes(6).toString('hex');
      const nu = { id: uid('u'), username: body.username, salt, pwdHash: hashPwd(body.password, salt), role: body.role || 'operator', name: body.name || body.username, createdAt: now() };
      db.users.push(nu);
      addLog(user, '创建用户', nu.username);
      saveDb(true);
      return json(res, 200, { ok: true });
    }
  }
  m = p.match(/^\/api\/users\/([\w-]+)$/);
  if (m && can(user, 'user_manage')) {
    const tu = db.users.find(x => x.id === m[1]);
    if (!tu) return json(res, 404, { error: '用户不存在' });
    if (method === 'DELETE') {
      if (tu.username === 'admin') return json(res, 400, { error: '不能删除超级管理员' });
      db.users = db.users.filter(x => x.id !== tu.id);
      addLog(user, '删除用户', tu.username);
      saveDb(true);
      return json(res, 200, { ok: true });
    }
    if (method === 'PUT') {
      if (body.password) { tu.salt = crypto.randomBytes(6).toString('hex'); tu.pwdHash = hashPwd(body.password, tu.salt); }
      if (body.role) tu.role = body.role;
      if (body.name) tu.name = body.name;
      addLog(user, '修改用户', tu.username);
      saveDb(true);
      return json(res, 200, { ok: true });
    }
  }

  /* ---- 操作日志 ---- */
  if (p === '/api/logs' && method === 'GET') return json(res, 200, { list: db.logs.slice(0, 100) });

  return json(res, 404, { error: '接口不存在: ' + p });
}

/* ============================ 启动 ============================ */
loadDb();
const server = http.createServer((req, res) => {
  route(req, res).catch(e => {
    console.error('[api]', e);
    try { json(res, 500, { error: '服务器内部错误' }); } catch {}
  });
});
server.listen(PORT, () => {
  console.log(`[fenxiao-saas] 闲鱼自动分销 SaaS 已启动: http://localhost:${PORT}`);
  console.log('[fenxiao-saas] 演示账号: admin/admin123(超管) shop/shop123(店管) ops/ops123(运营)');
});
setInterval(engineTick, 4000);
setInterval(() => saveDb(true), 15000); // 定期落盘
process.on('SIGTERM', () => { saveDb(true); process.exit(0); });
process.on('SIGINT', () => { saveDb(true); process.exit(0); });
