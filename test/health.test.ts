import { describe, expect, it } from 'vitest';
import { handler } from '../backend/handlers/health';

describe('API health endpoint', () => {
    it('returns an OK status, uptime, and timestamp as JSON', async () => {
        const response = await handler({});

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
        const body = JSON.parse(response.body);

        expect(body.status).toBe('ok');
        expect(body.uptime).toEqual(expect.any(Number));
        expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    });
});