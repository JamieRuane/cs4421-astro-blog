
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8080);
const ROOT = path.resolve('dist');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const pathname = new URL(
        req.url || '/',
        'http://localhost'
    ).pathname;

    let statusCode = 200;

    try {
        if (pathname === '/api/health') {
            const body = JSON.stringify({
                status: process.env.HEALTH_FAIL === 'true' ? 'error' : 'ok',
                uptime: process.uptime(),
                timestamp: new Date().toISOString(),
            });

            statusCode = process.env.HEALTH_FAIL === 'true' ? 500 : 200;
            res.writeHead(statusCode, {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': 'no-store',
            });
            res.end(body);
        } else if (req.method !== 'GET' && req.method !== 'HEAD') {
            statusCode = 405;
            res.writeHead(statusCode, { allow: 'GET, HEAD' });
            res.end();
        } else {
            const relativePath = pathname === '/'
                ? 'index.html'
                : pathname.replace(/^\/+/, '');

            const filePath = path.resolve(ROOT, relativePath);

            if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, 'index.html')) {
                statusCode = 403;
                res.writeHead(statusCode);
                res.end('Forbidden');
            } else {
                let actualPath = filePath;

                try {
                    const info = await stat(actualPath);
                    if (info.isDirectory()) actualPath = path.join(actualPath, 'index.html');
                } catch {
                    // Try Astro's directory-style route, then a plain HTML route.
                    actualPath = path.join(ROOT, relativePath, 'index.html');
                }

                try {
                    await stat(actualPath);
                } catch {
                    actualPath = path.join(ROOT, '404.html');
                    statusCode = 404;
                }

                res.writeHead(statusCode, {
                    'content-type': MIME_TYPES[path.extname(actualPath)] || 'application/octet-stream',
                    'x-content-type-options': 'nosniff',
                });

                if (req.method === 'HEAD') {
                    res.end();
                } else {
                    createReadStream(actualPath)
                        .on('error', () => {
                            if (!res.headersSent) res.writeHead(500);
                            res.end();
                        })
                        .pipe(res);
                }
            }
        }
    } catch {
        statusCode = 500;
        if (!res.headersSent) res.writeHead(statusCode);
        res.end('Internal Server Error');
    } finally {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            method: req.method,
            path: pathname,
            status: statusCode,
            durationMs: Date.now() - started,
        }));
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(JSON.stringify({
        event: 'server_started',
        port: PORT,
        timestamp: new Date().toISOString(),
    }));
});
