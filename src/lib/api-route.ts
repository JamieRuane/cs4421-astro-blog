import type { APIRoute } from 'astro';
import type { HttpApiEvent, HttpApiResponse } from '../../backend/handlers/http.js';

type ApiHandler = (event: HttpApiEvent) => Promise<HttpApiResponse>;

export async function invokeApiHandler(request: Request, handler: ApiHandler): Promise<Response> {
	const url = new URL(request.url);
	const body = request.method === 'GET' || request.method === 'HEAD'
		? undefined
		: await request.text();

	const response = await handler({
		version: '2.0',
		rawPath: url.pathname,
		queryStringParameters: Object.fromEntries(url.searchParams.entries()),
		headers: Object.fromEntries(request.headers.entries()),
		body,
		isBase64Encoded: false,
		requestContext: {
			http: {
				method: request.method,
				path: url.pathname,
			},
		},
	});

	return new Response(response.body, {
		status: response.statusCode,
		headers: response.headers,
	});
}

export const methodNotAllowed: APIRoute = ({ request }) => new Response(
	JSON.stringify({ status: 'error', error: 'Method not allowed.' }),
	{
		status: 405,
		headers: {
			allow: request.url.endsWith('/feedback') ? 'POST' : 'GET',
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'no-store',
		},
	},
);
