import {
	getHeader,
	getRequestBody,
	jsonResponse,
	type HttpApiEvent,
	type HttpApiResponse,
} from './http.js';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function handler(event: HttpApiEvent): Promise<HttpApiResponse> {
	if (!getHeader(event.headers, 'content-type')?.toLowerCase().includes('application/json')) {
		return jsonResponse({ status: 'error', error: 'Content-Type must be application/json.' }, 415);
	}

	let body: unknown;
	try {
		body = JSON.parse(getRequestBody(event));
	} catch (error) {
		if (error instanceof SyntaxError) {
			return jsonResponse({ status: 'error', error: 'Request body must be valid JSON.' }, 400);
		}
		throw error;
	}

	if (!isRecord(body)) {
		return jsonResponse({ status: 'error', error: 'Request body must be a JSON object.' }, 400);
	}

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	const message = typeof body.message === 'string' ? body.message.trim() : '';
	const email = typeof body.email === 'string' ? body.email.trim() : undefined;

	if (!name || name.length > 100) {
		return jsonResponse({ status: 'error', error: 'Name is required and must be at most 100 characters.' }, 400);
	}
	if (!message || message.length > 5000) {
		return jsonResponse(
			{ status: 'error', error: 'Message is required and must be at most 5000 characters.' },
			400,
		);
	}
	if (body.email !== undefined && (typeof body.email !== 'string' || !email || email.length > 254)) {
		return jsonResponse({ status: 'error', error: 'Email must be a valid non-empty string of at most 254 characters.' }, 400);
	}

	return jsonResponse(
		{
			status: 'received',
			message: 'Feedback received. This endpoint does not store submissions.',
		},
		201,
	);
}
