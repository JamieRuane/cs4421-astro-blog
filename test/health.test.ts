import { describe, expect, it } from 'vitest';
import { GET } from '../src/pages/api/health';

describe('health endpoint', () => {
    it('returns an OK status, uptime, and timestamp as JSON', async () => {
        const response = await GET();

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/json');

        const body = await response.json();

        expect(body.status).toBe('ok');
        expect(body.uptime).toEqual(expect.any(Number));
        expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    });
});