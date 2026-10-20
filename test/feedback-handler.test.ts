import { afterEach, describe, expect, it, vi } from 'vitest';
import { handler } from '../backend/handlers/feedback';

afterEach(() => {
	vi.restoreAllMocks();
});

function event(body: unknown, contentType = 'application/json') {
	return {
		headers: { 'content-type': contentType },
		body: typeof body === 'string' ? body : JSON.stringify(body),
		isBase64Encoded: false,
	};
}

describe('feedback Lambda handler', () => {
	it('rejects unsupported content types', async () => {
		const response = await handler(event({}, 'text/plain'));

		expect(response.statusCode).toBe(415);
		expect(JSON.parse(response.body)).toEqual({
			status: 'error',
			error: 'Content-Type must be application/json.',
		});
	});

	it('rejects malformed JSON and invalid feedback fields', async () => {
		expect((await handler(event('{'))).statusCode).toBe(400);
		expect((await handler(event({ name: '', message: '' }))).statusCode).toBe(400);
		expect((await handler(event({ name: 'Jamie', message: 'Hello', email: 42 }))).statusCode).toBe(400);
	});

	it('acknowledges valid feedback without logging or persisting its contents', async () => {
		const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
		const request = {
			name: 'Jamie',
			message: 'A private message',
			email: 'jamie@example.test',
		};

		const response = await handler(event(request));

		expect(response.statusCode).toBe(201);
		expect(JSON.parse(response.body)).toEqual({
			status: 'received',
			message: 'Feedback received. This endpoint does not store submissions.',
		});
		expect(response.body).not.toContain(request.message);
		expect(log).not.toHaveBeenCalled();
	});

	it('accepts a base64-encoded JSON event', async () => {
		const body = Buffer.from(JSON.stringify({ name: 'Jamie', message: 'Hello' })).toString('base64');

		const response = await handler({
			headers: { 'Content-Type': 'application/json' },
			body,
			isBase64Encoded: true,
		});

		expect(response.statusCode).toBe(201);
	});
});
