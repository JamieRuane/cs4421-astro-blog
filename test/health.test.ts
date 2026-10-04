import { describe, expect, it } from 'vitest';
import { GET } from '../src/pages/health.json';

describe('health endpoint', () => {
    it('returns a healthy status', async () => {
        const response = await GET({} as any);

        expect(response.status).toBe(200);

        const body = await response.json();

        expect(body).toEqual({
            status: 'healthy',
        });
    });
});