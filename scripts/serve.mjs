import http from 'node:http';
import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT는 1~65535 사이의 정수여야 합니다.');
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function respond(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return respond(res, 405, 'Method not allowed');
  }

  try {
    const rawPath = (req.url || '/').split('?')[0];
    const pathname = decodeURIComponent(rawPath);
    const parts = pathname.split('/');
    if (pathname.includes('\\') || pathname.includes('\0') ||
        parts.some(part => part.startsWith('.') || part.includes(':'))) {
      return respond(res, 404, 'Not found');
    }

    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const allowed = relative === 'index.html' || /^(assets|css|js)\//.test(relative);
    const contentType = mime[path.extname(relative).toLowerCase()];
    if (!allowed || !contentType) return respond(res, 404, 'Not found');

    const requestedFile = path.resolve(root, relative);
    const actualFile = await realpath(requestedFile);
    const actualRelative = path.relative(root, actualFile);
    if (actualRelative.startsWith('..') || path.isAbsolute(actualRelative) ||
        !(await stat(actualFile)).isFile()) {
      return respond(res, 404, 'Not found');
    }

    // Recheck the resolved target so a public symlink cannot expose private files.
    const normalized = actualRelative.split(path.sep).join('/');
    if (normalized.split('/').some(part => part.startsWith('.')) ||
        !mime[path.extname(actualFile).toLowerCase()] ||
        (normalized !== 'index.html' && !/^(assets|css|js)\//.test(normalized))) {
      return respond(res, 404, 'Not found');
    }
    const body = await readFile(actualFile);
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (error instanceof URIError || ['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) {
      return respond(res, 404, 'Not found');
    }
    respond(res, 500, 'Unable to read file');
  }
});

server.on('error', error => {
  console.error(`미리보기 서버를 시작하지 못했습니다: ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`하루의 무게: http://127.0.0.1:${port}`);
  console.log('종료: Ctrl+C');
});
