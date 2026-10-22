import { Buffer } from 'node:buffer';

const handlers = {
	'GET /api/weather': '/backend/handlers/weather.ts',
	'GET /api/movies': '/backend/handlers/movies.ts',
	'POST /api/feedback': '/backend/handlers/feedback.ts',
	'GET /api/health': '/backend/handlers/health.ts',
	'GET /api/reliability': '/backend/handlers/reliability.ts',
};

export function localApiPlugin() {
	return {
		name: 'local-api',
		configureServer(server) {
			const loadedHandlers = new Map();

			server.middlewares.use(async (request, response, next) => {
				const method = request.method ?? 'GET';
				const url = new URL(request.url ?? '/', 'http://localhost');
				const key = `${method} ${url.pathname}`;
				const handlerPath = handlers[key];

				if (!handlerPath) {
					if (url.pathname.startsWith('/api/')) {
						response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
						response.end(JSON.stringify({ status: 'error', error: 'Not found.' }));
						return;
					}
					next();
					return;
				}

				try {
					let handlerPromise = loadedHandlers.get(handlerPath);
					if (!handlerPromise) {
						handlerPromise = server.ssrLoadModule(handlerPath).then((module) => module.handler);
						loadedHandlers.set(handlerPath, handlerPromise);
					}

					const chunks = [];
					for await (const chunk of request) {
						chunks.push(Buffer.from(chunk));
					}
					const body = Buffer.concat(chunks).toString('utf8');
					const result = await (await handlerPromise)({
						version: '2.0',
						routeKey: key,
						rawPath: url.pathname,
						queryStringParameters: Object.fromEntries(url.searchParams.entries()),
						headers: request.headers,
						body: body || undefined,
						isBase64Encoded: false,
						requestContext: {
							http: { method, path: url.pathname },
						},
					});

					response.writeHead(result.statusCode, result.headers);
					response.end(result.body);
				} catch (error) {
					console.error('Local API handler failed', error);
					if (!response.headersSent) {
						response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
					}
					response.end(JSON.stringify({ status: 'error', error: 'Internal server error.' }));
				}
			});
		},
	};
}
