const assert = require('assert');

const CREDS = { BASIC_USER: 'admin', BASIC_PASS: 's3cret' };
const GOOD_AUTH = 'Basic ' + Buffer.from('admin:s3cret').toString('base64');
const BAD_AUTH = 'Basic ' + Buffer.from('admin:wrong').toString('base64');
// Long enough (> 39 chars of path) to take the Telegram Bot API branch.
const TG_ID = 'AgACAgEAAxkDAAMDZt1Gzs4W8dQPWiQJxO5YSH5X-gsAAt';

const noop = async () => new Response('');

function nextSpy() {
  const spy = async () => { spy.called = true; return new Response('next'); };
  spy.called = false;
  return spy;
}

describe('site lock middleware', function () {
  let siteLock;
  before(async function () {
    siteLock = (await import('../functions/_middleware.js')).onRequest[0];
  });

  async function run(path, { env = CREDS, auth, method = 'GET' } = {}) {
    const headers = auth ? { Authorization: auth } : {};
    const next = nextSpy();
    const res = await siteLock({ request: new Request(`https://img.example${path}`, { method, headers }), env, next });
    return { res, next };
  }

  for (const path of ['/', '/index.html', '/upload', '/admin', '/admin.html', '/api/manage/list', '/api/bing/wallpaper', '/_nuxt/x.js']) {
    it(`requires login for ${path}`, async function () {
      const { res, next } = await run(path, { method: path === '/upload' ? 'POST' : 'GET' });
      assert.strictEqual(res.status, 401);
      assert.match(res.headers.get('WWW-Authenticate'), /^Basic /);
      assert.strictEqual(next.called, false);
    });
  }

  it('rejects a wrong password and a malformed header', async function () {
    assert.strictEqual((await run('/upload', { auth: BAD_AUTH, method: 'POST' })).res.status, 401);
    assert.strictEqual((await run('/upload', { auth: 'Basic !!!notbase64', method: 'POST' })).res.status, 401);
    assert.strictEqual((await run('/upload', { auth: 'Bearer abc', method: 'POST' })).res.status, 401);
  });

  it('lets the right credentials through', async function () {
    const { next } = await run('/upload', { auth: GOOD_AUTH, method: 'POST' });
    assert.strictEqual(next.called, true);
  });

  for (const path of [`/file/${TG_ID}.png`, '/file/abc.jpg', '/api/telegram-webhook', '/block-img.html', '/block-img', '/whitelist-on.html', '/favicon.ico']) {
    it(`keeps ${path} public`, async function () {
      const { next } = await run(path);
      assert.strictEqual(next.called, true);
    });
  }

  it('does not treat look-alike paths as public', async function () {
    for (const path of ['/filex/a.png', '/api/telegram-webhook/x', '/file']) {
      assert.strictEqual((await run(path)).res.status, 401, path);
    }
  });

  it('refuses uploads when credentials are not configured, but leaves pages open', async function () {
    for (const env of [{}, { BASIC_USER: 'admin' }, { BASIC_USER: 'admin', BASIC_PASS: '' }]) {
      const up = await run('/upload', { env, method: 'POST' });
      assert.strictEqual(up.res.status, 403);
      assert.strictEqual(up.next.called, false);
      const page = await run('/', { env });
      assert.strictEqual(page.next.called, true);
    }
  });
});

describe('upload endpoint', function () {
  let onRequestPost;
  const realFetch = global.fetch;
  let telegramCalls;

  before(async function () {
    onRequestPost = (await import('../functions/upload.js')).onRequestPost;
  });
  beforeEach(function () {
    telegramCalls = [];
    global.fetch = async (url) => {
      telegramCalls.push(String(url));
      return new Response(JSON.stringify({ ok: true, result: { photo: [{ file_id: 'PHOTOID', file_size: 10 }] } }), { status: 200 });
    };
  });
  afterEach(function () { global.fetch = realFetch; });

  const ENV = { ...CREDS, TG_Bot_Token: 'T', TG_Chat_ID: '1', disable_telemetry: '1' };

  function uploadRequest(name, type, auth = GOOD_AUTH) {
    const form = new FormData();
    form.append('file', new File(['payload'], name, { type }));
    const headers = auth ? { Authorization: auth } : {};
    return new Request('https://img.example/upload', { method: 'POST', body: form, headers });
  }

  it('rejects requests without valid credentials', async function () {
    let res = await onRequestPost({ request: uploadRequest('cat.png', 'image/png', null), env: ENV, data: {}, next: noop });
    assert.strictEqual(res.status, 401);
    res = await onRequestPost({ request: uploadRequest('cat.png', 'image/png', BAD_AUTH), env: ENV, data: {}, next: noop });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(telegramCalls.length, 0);
  });

  it('is disabled when credentials are not configured', async function () {
    const env = { TG_Bot_Token: 'T', TG_Chat_ID: '1', disable_telemetry: '1' };
    const res = await onRequestPost({ request: uploadRequest('cat.png', 'image/png'), env, data: {}, next: noop });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(telegramCalls.length, 0);
  });

  // The exact probe files seen in the Telegram channel, all claiming to be images.
  for (const name of ['v816.php7', 'stm.stm', 'shtm.shtm', 'xml.xml', 'css.css', 'evil.xml', 'a816', 'x.svg', 'x.html', 'x.php', '.png', 'x.png.', 'x.pHp7']) {
    it(`rejects ${JSON.stringify(name)} even with an image MIME type`, async function () {
      const res = await onRequestPost({ request: uploadRequest(name, 'image/png'), env: ENV, data: {}, next: noop });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(telegramCalls.length, 0);
    });
  }

  it('rejects an allowed extension whose MIME type claims another category', async function () {
    const res = await onRequestPost({ request: uploadRequest('cat.png', 'text/html'), env: ENV, data: {}, next: noop });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(telegramCalls.length, 0);
  });

  it('accepts a normal image and sends it to Telegram as a photo', async function () {
    const res = await onRequestPost({ request: uploadRequest('Cat.PNG', 'image/png'), env: ENV, data: {}, next: noop });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(JSON.parse(await res.text()), [{ src: '/file/PHOTOID.png' }]);
    assert.strictEqual(telegramCalls.length, 1);
    assert.match(telegramCalls[0], /\/sendPhoto$/);
  });

  it('accepts an image whose MIME type is missing', async function () {
    const res = await onRequestPost({ request: uploadRequest('photo.heic', ''), env: ENV, data: {}, next: noop });
    assert.strictEqual(res.status, 200);
  });
});

describe('file serving', function () {
  let onRequest;
  const realFetch = global.fetch;
  let downloadInit;

  before(async function () {
    onRequest = (await import('../functions/file/[id].js')).onRequest;
  });
  afterEach(function () { global.fetch = realFetch; });

  function mockTelegram(filePath, upstream) {
    global.fetch = async (url, init) => {
      url = String(url);
      if (url.includes('/getFile?')) {
        return new Response(JSON.stringify({ ok: true, result: { file_path: filePath } }), { status: 200 });
      }
      downloadInit = init;
      return upstream();
    };
  }

  async function get(id, headers = {}) {
    const request = new Request(`https://img.example/file/${id}`, { headers });
    return onRequest({ request, env: { TG_Bot_Token: 'T' }, params: { id } });
  }

  it('serves allowlisted files with a fixed type and nosniff', async function () {
    mockTelegram('photos/file_1.jpg', () => new Response('<html><script>alert(1)</script>', { headers: { 'Content-Type': 'text/html' } }));
    const res = await get(`${TG_ID}.png`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('Content-Type'), 'image/png');
    assert.strictEqual(res.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.strictEqual(res.headers.get('Content-Disposition'), null);
  });

  for (const id of [`${TG_ID}.xml`, `${TG_ID}.shtm`, `${TG_ID}.svg`, `${TG_ID}.html`, TG_ID + 'a816']) {
    it(`serves ${id.slice(TG_ID.length) || '(no extension)'} only as a sandboxed download`, async function () {
      mockTelegram('documents/file_2.xml', () => new Response('<x/>', { headers: { 'Content-Type': 'application/xml' } }));
      const res = await get(id);
      assert.strictEqual(res.headers.get('Content-Type'), 'application/octet-stream');
      assert.strictEqual(res.headers.get('Content-Disposition'), 'attachment');
      assert.match(res.headers.get('Content-Security-Policy'), /sandbox/);
      assert.strictEqual(res.headers.get('X-Content-Type-Options'), 'nosniff');
    });
  }

  it('does not forward the visitor\'s credentials or cookies upstream', async function () {
    mockTelegram('photos/file_1.jpg', () => new Response('img', { headers: { 'Content-Type': 'image/jpeg' } }));
    await get(`${TG_ID}.jpg`, { Authorization: GOOD_AUTH, Cookie: 'a=b', Range: 'bytes=0-1' });
    const sent = new Headers(downloadInit.headers);
    assert.strictEqual(sent.get('authorization'), null);
    assert.strictEqual(sent.get('cookie'), null);
    assert.strictEqual(sent.get('range'), 'bytes=0-1');
    assert.strictEqual(downloadInit.method, 'GET');
    assert.strictEqual(downloadInit.body, undefined);
  });

  it('does not relay upstream error bodies', async function () {
    mockTelegram('photos/file_1.jpg', () => new Response('<html>evil</html>', { status: 404, headers: { 'Content-Type': 'text/html' } }));
    const res = await get(`${TG_ID}.png`);
    assert.strictEqual(res.status, 404);
    assert.match(res.headers.get('Content-Type'), /^text\/plain/);
    assert.doesNotMatch(await res.text(), /evil/);
  });

  it('passes 304 Not Modified through without a body', async function () {
    mockTelegram('photos/file_1.jpg', () => new Response(null, { status: 304 }));
    const res = await get(`${TG_ID}.png`, { 'If-None-Match': '"x"' });
    assert.strictEqual(res.status, 304);
    assert.strictEqual(res.headers.get('X-Content-Type-Options'), 'nosniff');
  });
});

describe('telemetry', function () {
  it('never tags credentials, cookies or query strings', async function () {
    const { telemetryData } = await import('../functions/utils/middleware.js');
    const tags = {};
    let ctx;
    const context = {
      env: {},
      request: new Request('https://img.example/api/telegram-webhook?secret=TOPSECRET', {
        headers: { Authorization: GOOD_AUTH, Cookie: 'sid=1', 'User-Agent': 'ua' },
      }),
      data: {
        sentry: {
          setTag: (k, v) => { tags[k] = v; },
          setContext: (_k, v) => { ctx = v; },
          startTransaction: () => ({ finish() {} }),
        },
      },
      next: async () => new Response('ok'),
    };
    context.request.cf = {};
    await telemetryData(context);
    const dump = JSON.stringify({ tags, ctx });
    assert.ok(!/s3cret|YWRtaW46czNjcmV0|sid=1|TOPSECRET/.test(dump), dump);
    assert.strictEqual(tags['user-agent'], 'ua');
  });
});
