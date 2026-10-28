// 將 openapi.json 轉為 Postman Collection v2.1（無額外相依套件）
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'openapi.json'), 'utf8'));
const outFile = path.join(root, 'postman_collection.json');

const EXAMPLES = {
  email: 'user@example.com',
  password: 'Password123',
  name: 'Test User',
  recipientName: '王小明',
  recipientEmail: 'user@example.com',
  recipientAddress: '台北市信義區信義路 1 號',
};

// forResponse：回應範例不用 {{變數}} 佔位，字串給 'string'、nullable 給 null
function exampleOf(schema, key, forResponse = false) {
  if (!schema) return null;
  if (schema.example !== undefined) return schema.example;
  if (forResponse && schema.nullable) return null;
  if (!forResponse && key in EXAMPLES && schema.type === 'string') return EXAMPLES[key];
  if (schema.enum) return schema.enum[0];
  if (schema.default !== undefined) return schema.default;
  switch (schema.type) {
    case 'object':
      return Object.fromEntries(
        Object.entries(schema.properties || {}).map(([k, v]) => [k, exampleOf(v, k, forResponse)])
      );
    case 'array': return [exampleOf(schema.items, undefined, forResponse)];
    case 'integer':
    case 'number': return schema.minimum !== undefined ? schema.minimum : 1;
    case 'boolean': return false;
    default: return key && !forResponse ? `{{${key}}}` : 'string';
  }
}

const hasBearer = (op) => (op.security || []).some((s) => s.bearerAuth);
const hasSession = (op) => (op.security || []).some((s) => s.sessionId);

function buildRequest(method, urlPath, op) {
  const pathVars = [];
  const segs = urlPath.split('/').filter(Boolean).map((s) => {
    const m = s.match(/^\{(.+)\}$/);
    if (!m) return s;
    pathVars.push({ key: m[1], value: `{{${m[1]}}}` });
    pathParamNames.add(m[1]);
    return `:${m[1]}`;
  });
  const query = (op.parameters || [])
    .filter((p) => p.in === 'query')
    .map((p) => ({ key: p.name, value: String(exampleOf(p.schema) ?? ''), disabled: !p.required }));
  const rawQuery = query.length ? '?' + query.map((q) => `${q.key}=${q.value}`).join('&') : '';

  const header = [];
  const req = {
    method: method.toUpperCase(),
    header,
    url: {
      raw: `{{baseUrl}}/${segs.join('/')}${rawQuery}`,
      host: ['{{baseUrl}}'],
      path: segs,
      ...(query.length && { query }),
      ...(pathVars.length && { variable: pathVars }),
    },
    description: [op.summary, op.description].filter(Boolean).join('\n\n'),
  };

  const bearer = hasBearer(op);
  const session = hasSession(op);
  if (bearer && session) {
    // dualAuth：預設走 X-Session-Id（訪客）；已登入時啟用 Authorization 即優先使用 JWT
    header.push({ key: 'Authorization', value: 'Bearer {{token}}', disabled: true });
    header.push({ key: 'X-Session-Id', value: '{{sessionId}}' });
  } else if (bearer) {
    req.auth = { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] };
  } else {
    req.auth = { type: 'noauth' };
  }

  const json = op.requestBody && op.requestBody.content && op.requestBody.content['application/json'];
  if (json) {
    header.push({ key: 'Content-Type', value: 'application/json' });
    req.body = {
      mode: 'raw',
      raw: JSON.stringify(exampleOf(json.schema), null, 2),
      options: { raw: { language: 'json' } },
    };
  }
  return req;
}

const STATUS_TEXT = {
  200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized',
  403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 500: 'Internal Server Error',
};

// 將 OpenAPI responses 轉為 Postman 的 Saved Examples（含回應 schema 產生的範例 body）
function buildResponses(op, request) {
  return Object.entries(op.responses || {}).map(([code, res]) => {
    const json = res.content && res.content['application/json'];
    return {
      name: `${code} ${res.description || ''}`.trim(),
      originalRequest: request,
      status: STATUS_TEXT[code] || res.description || '',
      code: Number(code) || 0,
      _postman_previewlanguage: json ? 'json' : 'text',
      header: json ? [{ key: 'Content-Type', value: 'application/json' }] : [],
      body: json ? JSON.stringify(exampleOf(json.schema, undefined, true), null, 2) : '',
    };
  });
}

// 登入/註冊成功後自動存 JWT；訪客購物車自動產生 sessionId
function buildTests(urlPath) {
  if (urlPath === '/api/auth/login' || urlPath === '/api/auth/register') {
    return [
      'pm.test("status 2xx", () => pm.response.to.be.success);',
      'const body = pm.response.json();',
      'if (body && body.data && body.data.token) {',
      '  pm.collectionVariables.set("token", body.data.token);',
      '}',
    ];
  }
  return null;
}

const pathParamNames = new Set(['productId']);
const folders = new Map();
for (const [urlPath, methods] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    const tag = (op.tags && op.tags[0]) || 'Default';
    if (!folders.has(tag)) folders.set(tag, []);
    const request = buildRequest(method, urlPath, op);
    const item = {
      name: op.summary || `${method.toUpperCase()} ${urlPath}`,
      request,
      response: buildResponses(op, request),
    };
    const tests = buildTests(urlPath);
    if (tests) item.event = [{ listen: 'test', script: { type: 'text/javascript', exec: tests } }];
    folders.get(tag).push(item);
  }
}

const collection = {
  info: {
    name: spec.info.title,
    description: spec.info.description,
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [
    { key: 'baseUrl', value: 'http://localhost:3001', type: 'string' },
    { key: 'token', value: '', type: 'string' },
    { key: 'sessionId', value: 'postman-session-001', type: 'string' },
    ...[...pathParamNames].map((key) => ({ key, value: '', type: 'string' })),
  ],
  event: [{
    listen: 'prerequest',
    script: {
      type: 'text/javascript',
      exec: [
        'if (!pm.collectionVariables.get("sessionId")) {',
        '  pm.collectionVariables.set("sessionId", "postman-" + Date.now());',
        '}',
      ],
    },
  }],
  item: [...folders].map(([name, item]) => ({ name, item })),
};

fs.writeFileSync(outFile, JSON.stringify(collection, null, 2) + '\n');
console.log(`postman_collection.json generated (${[...folders.values()].flat().length} requests)`);
