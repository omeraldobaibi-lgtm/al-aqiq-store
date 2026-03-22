const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ORDERS_FILE = path.join(__dirname, 'data', 'orders.json');
const PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function ensureJsonFile(filePath, fallback) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf8');
  }
}

function readJson(filePath, fallback) {
  ensureJsonFile(filePath, fallback);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureJsonFile(filePath, []);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function createOrderNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const t = Date.now().toString().slice(-6);
  return `AQ-${y}${m}${d}-${t}`;
}

function sanitizeText(value, max = 250) {
  return String(value || '').trim().slice(0, max);
}

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      const isIpv4 = net.family === 'IPv4' || net.family === 4;
      if (isIpv4 && !net.internal) addresses.push(net.address);
    }
  }
  return addresses;
}

app.get('/api/products', (req, res) => {
  const products = readJson(PRODUCTS_FILE, []);
  res.json(products);
});

app.post('/api/orders', (req, res) => {
  const body = req.body || {};
  const name = sanitizeText(body.customerName, 120);
  const phone = sanitizeText(body.customerPhone, 40);
  const area = sanitizeText(body.customerArea, 120);
  const pay = sanitizeText(body.customerPay, 120);
  const notes = sanitizeText(body.customerNotes, 1000);
  const items = Array.isArray(body.items) ? body.items : [];

  if (!name || !area || !items.length) {
    return res.status(400).json({ ok: false, message: 'الاسم والمنطقة والمنتجات مطلوبة.' });
  }

  const products = readJson(PRODUCTS_FILE, []);
  const productMap = new Map(products.map((product) => [product.id, product]));

  const normalizedItems = [];
  let total = 0;

  for (const item of items) {
    const product = productMap.get(item.id);
    const qty = Number(item.qty || 0);
    if (!product || !Number.isFinite(qty) || qty <= 0) continue;

    const lineTotal = qty * Number(product.price || 0);
    total += lineTotal;

    normalizedItems.push({
      id: product.id,
      title: product.title,
      unit: product.unit,
      price: product.price,
      qty,
      lineTotal
    });
  }

  if (!normalizedItems.length) {
    return res.status(400).json({ ok: false, message: 'السلة فارغة أو تحتوي على أصناف غير صحيحة.' });
  }

  const orders = readJson(ORDERS_FILE, []);
  const order = {
    id: createOrderNumber(),
    customerName: name,
    customerPhone: phone,
    customerArea: area,
    customerPay: pay,
    customerNotes: notes,
    items: normalizedItems,
    total,
    status: 'جديد',
    createdAt: new Date().toISOString()
  };

  orders.unshift(order);
  writeJson(ORDERS_FILE, orders);

  res.json({
    ok: true,
    message: 'تم إرسال الطلب إلى السيرفر بنجاح.',
    orderId: order.id
  });
});

app.get('/api/orders', (req, res) => {
  const password = req.headers['x-admin-password'];
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, message: 'غير مصرح' });
  }
  const orders = readJson(ORDERS_FILE, []);
  res.json({ ok: true, orders });
});

app.patch('/api/orders/:id/status', (req, res) => {
  const password = req.headers['x-admin-password'];
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, message: 'غير مصرح' });
  }

  const newStatus = sanitizeText(req.body.status, 50);
  const allowed = ['جديد', 'قيد المراجعة', 'تم التواصل', 'مكتمل', 'ملغي'];
  if (!allowed.includes(newStatus)) {
    return res.status(400).json({ ok: false, message: 'حالة غير صالحة' });
  }

  const orders = readJson(ORDERS_FILE, []);
  const order = orders.find((item) => item.id === req.params.id);
  if (!order) {
    return res.status(404).json({ ok: false, message: 'الطلب غير موجود' });
  }

  order.status = newStatus;
  writeJson(ORDERS_FILE, orders);
  res.json({ ok: true, message: 'تم تحديث الحالة' });
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, HOST, () => {
  const ips = getLocalIpAddresses();
  console.log(`Server running on http://localhost:${PORT}`);
  if (ips.length) {
    console.log('Open from another device on the same network using:');
    ips.forEach((ip) => console.log(`http://${ip}:${PORT}`));
  }
  console.log(`Admin password: ${ADMIN_PASSWORD}`);
});