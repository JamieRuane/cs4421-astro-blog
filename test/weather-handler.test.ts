import { afterEach, describe, expect, it, vi } from 'vitest';
import { handler } from '../backend/handlers/weather';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('weather Lambda handler', () => {
	it('returns the existing weather response shape and cache policy', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
			current: { temperature_2m: 12, weather_code: 1 },
			current_units: { temperature_2m: '°C' },
		}))));

		const response = await handler({});

		expect(response.statusCode).toBe(200);
		expect(response.headers['cache-control']).toContain('max-age=600');
		expect(JSON.parse(response.body)).toMatchObject({
			location: 'Askeaton, County Limerick',
			latitude: 52.5997,
			longitude: -8.9756,
			current: { temperature_2m: 12, weather_code: 1 },
		});
	});

	it('returns a safe error response when the provider fails', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('upstream error', { status: 503 })));
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const response = await handler({});

		expect(response.statusCode).toBe(502);
		expect(response.headers['cache-control']).toBe('no-store');
		expect(JSON.parse(response.body)).toEqual({
			status: 'error',
			error: 'Weather data is temporarily unavailable.',
		});
		expect(errorLog).toHaveBeenCalledOnce();
	});

	it('rejects a successful provider response without current conditions', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		expect((await handler({})).statusCode).toBe(502);
	});

	it('returns the safe error response when the provider request times out', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Timed out', 'TimeoutError')));
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const response = await handler({});

		expect(response.statusCode).toBe(502);
		expect(JSON.parse(response.body).error).toBe('Weather data is temporarily unavailable.');
	});
});
