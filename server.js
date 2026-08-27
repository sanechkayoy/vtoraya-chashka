const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const root = __dirname;
const dataPath = path.join(root, 'data', 'db.json');

// ======================================================
// НАСТРОЙКИ
// ======================================================

// Пароль администратора.
// Лучше потом заменить его на свой.
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || 'VtorayaChashka2026!';

// Время жизни сессии: 2 часа
const SESSION_TTL = 2 * 60 * 60 * 1000;

// Хранилище активных сессий
const sessions = new Map();

// ======================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ======================================================

const mime = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

function send(res, code, type, body, extraHeaders = {}) {
  res.writeHead(code, {
    'Content-Type': `${type}; charset=utf-8`,
    'Cache-Control': 'no-store',
    ...extraHeaders
  });

  res.end(body);
}

function readData() {
  try {
    if (!fs.existsSync(dataPath)) {
      return {};
    }

    return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } catch (e) {
    console.error('Ошибка чтения db.json:', e.message);
    return {};
  }
}

function saveData(data) {
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });

  fs.writeFileSync(
    dataPath,
    JSON.stringify(data, null, 2),
    'utf8'
  );
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();

      // Защита от слишком большого запроса
      if (body.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
}

// ======================================================
// ПРОВЕРКА ПАРОЛЯ
// ======================================================

function checkPassword(inputPassword) {
  const a = Buffer.from(String(inputPassword || ''));
  const b = Buffer.from(ADMIN_PASSWORD);

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

// ======================================================
// СЕССИИ
// ======================================================

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');

  sessions.set(token, {
    created: Date.now(),
    expires: Date.now() + SESSION_TTL
  });

  return token;
}

function getSessionFromRequest(req) {
  const cookieHeader = req.headers.cookie || '';

  const cookies = {};

  cookieHeader.split(';').forEach(part => {
    const index = part.indexOf('=');

    if (index === -1) return;

    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    cookies[name] = decodeURIComponent(value);
  });

  const token = cookies.admin_session;

  if (!token) {
    return null;
  }

  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  if (Date.now() > session.expires) {
    sessions.delete(token);
    return null;
  }

  // Продлеваем сессию
  session.expires = Date.now() + SESSION_TTL;

  return {
    token,
    session
  };
}

function isAdmin(req) {
  return !!getSessionFromRequest(req);
}

// ======================================================
// СТРАНИЦА ВХОДА
// ======================================================

function loginPage(error = '') {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Админка — Вторая Чашка</title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f5f1eb;
      font-family: Arial, sans-serif;
    }

    .login {
      width: 420px;
      max-width: calc(100% - 30px);
      background: white;
      padding: 40px;
      border-radius: 18px;
      box-shadow: 0 10px 40px rgba(0,0,0,.12);
    }

    h1 {
      margin: 0 0 10px;
      color: #3d2b22;
      font-size: 34px;
    }

    p {
      color: #777;
      line-height: 1.5;
    }

    label {
      display: block;
      margin-top: 25px;
      margin-bottom: 8px;
      font-weight: bold;
      color: #3d2b22;
    }

    input {
      width: 100%;
      padding: 14px;
      font-size: 16px;
      border: 1px solid #ddd;
      border-radius: 10px;
      outline: none;
    }

    input:focus {
      border-color: #8b5e3c;
    }

    button {
      margin-top: 20px;
      padding: 13px 24px;
      border: 0;
      border-radius: 10px;
      background: #7a4d32;
      color: white;
      font-size: 16px;
      cursor: pointer;
    }

    button:hover {
      background: #633d29;
    }

    .error {
      margin-top: 15px;
      padding: 12px;
      border-radius: 8px;
      background: #ffe7e7;
      color: #a00000;
    }
  </style>
</head>

<body>

  <form class="login" method="POST" action="/api/admin/login">
    <h1>Вход</h1>

    <p>
      Введите пароль администратора,
      чтобы открыть панель управления.
    </p>

    <label for="password">Пароль</label>

    <input
      id="password"
      name="password"
      type="password"
      placeholder="Введите пароль"
      autocomplete="current-password"
      required
      autofocus
    >

    <button type="submit">
      Войти
    </button>

    ${
      error
        ? `<div class="error">${escapeHtml(error)}</div>`
        : ''
    }
  </form>

</body>
</html>`;
}

// ======================================================
// ЭКРАНИРОВАНИЕ HTML
// ======================================================

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ======================================================
// АВТОРИЗАЦИЯ
// ======================================================

function parseLoginBody(body) {
  // Поддержка обычной HTML-формы
  const params = new URLSearchParams(body);

  return params.get('password') || '';
}

async function handleLogin(req, res) {
  try {
    const body = await new Promise((resolve, reject) => {
      let data = '';

      req.on('data', chunk => {
        data += chunk.toString();

        if (data.length > 10000) {
          reject(new Error('Too large'));
        }
      });

      req.on('end', () => resolve(data));
      req.on('error', reject);
    });

    let password = '';

    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('application/json')) {
      try {
        const json = JSON.parse(body);
        password = json.password || '';
      } catch {
        password = '';
      }
    } else {
      password = parseLoginBody(body);
    }

    if (!checkPassword(password)) {
      return send(
        res,
        401,
        'text/html',
        loginPage('Неверный пароль.')
      );
    }

    const token = createSession();

    res.writeHead(302, {
      'Location': '/admin',
      'Set-Cookie':
        `admin_session=${encodeURIComponent(token)}; ` +
        `HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`
    });

    res.end();

  } catch (e) {
    console.error('Ошибка входа:', e.message);

    send(
      res,
      500,
      'text/plain',
      'Ошибка сервера'
    );
  }
}

// ======================================================
// ВЫХОД
// ======================================================

function handleLogout(req, res) {
  const session = getSessionFromRequest(req);

  if (session) {
    sessions.delete(session.token);
  }

  res.writeHead(302, {
    'Location': '/admin',
    'Set-Cookie':
      'admin_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0'
  });

  res.end();
}

// ======================================================
// СТАТИЧЕСКИЕ ФАЙЛЫ
// ======================================================

function safeFilePath(requestPath) {
  let decoded;

  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  decoded = decoded.split('?')[0];

  // Не разрешаем переходить выше корневой папки
  if (decoded.includes('..')) {
    return null;
  }

  return path.join(root, decoded);
}

function serveFile(res, filePath) {
  try {
    if (
      fs.existsSync(filePath) &&
      fs.statSync(filePath).isFile()
    ) {
      const ext = path.extname(filePath).toLowerCase();

      const type = mime[ext] || 'text/plain';

      return send(
        res,
        200,
        type,
        fs.readFileSync(filePath)
      );
    }

    return send(
      res,
      404,
      'text/plain',
      'Not found'
    );

  } catch (e) {
    console.error('Ошибка файла:', e.message);

    return send(
      res,
      500,
      'text/plain',
      'Server error'
    );
  }
}

// ======================================================
// СЕРВЕР
// ======================================================

const server = http.createServer(async (req, res) => {

  try {
    const requestUrl = new URL(
      req.url,
      `http://${req.headers.host || 'localhost'}`
    );

    const p = requestUrl.pathname;

    // --------------------------------------------------
    // API: LOGIN
    // --------------------------------------------------

    if (
      p === '/api/admin/login' &&
      req.method === 'POST'
    ) {
      return handleLogin(req, res);
    }

    // --------------------------------------------------
    // LOGOUT
    // --------------------------------------------------

    if (
      p === '/api/admin/logout' &&
      req.method === 'POST'
    ) {
      return handleLogout(req, res);
    }

    if (
      p === '/logout'
    ) {
      return handleLogout(req, res);
    }

    // --------------------------------------------------
    // API: DATA
    // --------------------------------------------------

    if (
      p === '/api/data' &&
      req.method === 'GET'
    ) {
      return send(
        res,
        200,
        'application/json',
        JSON.stringify(readData())
      );
    }

    // --------------------------------------------------
    // API: SAVE
    // ТОЛЬКО ДЛЯ АДМИНА
    // --------------------------------------------------

    if (
      p === '/api/save' &&
      req.method === 'POST'
    ) {

      if (!isAdmin(req)) {
        return send(
          res,
          401,
          'application/json',
          JSON.stringify({
            ok: false,
            error: 'Unauthorized'
          })
        );
      }

      try {
        const data = await readBody(req);

        saveData(data);

        return send(
          res,
          200,
          'application/json',
          JSON.stringify({
            ok: true
          })
        );

      } catch (e) {
        console.error('Ошибка сохранения:', e.message);

        return send(
          res,
          400,
          'application/json',
          JSON.stringify({
            ok: false,
            error: 'Invalid data'
          })
        );
      }
    }

    // --------------------------------------------------
    // /admin
    // --------------------------------------------------

    if (p === '/admin') {

      if (!isAdmin(req)) {
        return send(
          res,
          200,
          'text/html',
          loginPage()
        );
      }

      const adminFile = path.join(root, 'admin.html');

      if (
        fs.existsSync(adminFile) &&
        fs.statSync(adminFile).isFile()
      ) {
        return serveFile(res, adminFile);
      }

      return send(
        res,
        404,
        'text/plain',
        'Файл admin.html не найден'
      );
    }

    // --------------------------------------------------
    // /admin.html
    // --------------------------------------------------

    if (p === '/admin.html') {

      if (!isAdmin(req)) {
        res.writeHead(302, {
          Location: '/admin'
        });

        return res.end();
      }

      return serveFile(
        res,
        path.join(root, 'admin.html')
      );
    }

    // --------------------------------------------------
    // ГЛАВНАЯ
    // --------------------------------------------------

    if (p === '/') {
      return serveFile(
        res,
        path.join(root, 'public', 'index.html')
      );
    }

    // --------------------------------------------------
    // PUBLIC ФАЙЛЫ
    // --------------------------------------------------

    if (p.startsWith('/public/')) {
      const filePath = safeFilePath(p);

      if (!filePath) {
        return send(
          res,
          400,
          'text/plain',
          'Bad request'
        );
      }

      return serveFile(res, filePath);
    }

    // --------------------------------------------------
    // ОСТАЛЬНЫЕ ФАЙЛЫ
    // --------------------------------------------------

    const filePath = safeFilePath(p);

    if (filePath) {
      return serveFile(res, filePath);
    }

    return send(
      res,
      400,
      'text/plain',
      'Bad request'
    );

  } catch (e) {

    console.error('Ошибка сервера:', e);

    return send(
      res,
      500,
      'text/plain',
      'Server error'
    );
  }
});

// ======================================================
// ОЧИСТКА СТАРЫХ СЕССИЙ
// ======================================================

setInterval(() => {
  const now = Date.now();

  for (const [token, session] of sessions) {
    if (now > session.expires) {
      sessions.delete(token);
    }
  }
}, 10 * 60 * 1000);

// ======================================================
// ЗАПУСК
// ======================================================

const PORT = 3000;

server.listen(PORT, () => {
  console.log('');
  console.log('========================================');
  console.log('   ВТОРАЯ ЧАШКА — СЕРВЕР ЗАПУЩЕН');
  console.log('========================================');
  console.log('');
  console.log(`Сайт:    http://localhost:${PORT}`);
  console.log(`Админка: http://localhost:${PORT}/admin`);
  console.log('');
  console.log('Пароль администратора:');
  console.log(ADMIN_PASSWORD);
  console.log('');
  console.log('Для остановки нажмите Ctrl+C');
  console.log('');
});