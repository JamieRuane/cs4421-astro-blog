import { jsonResponse, type HttpApiEvent, type HttpApiResponse } from './http.js';

export async function handler(_event: HttpApiEvent): Promise<HttpApiResponse> {
	return jsonResponse({
		status: 'ok',
		uptime: process.uptime(),
		timestamp: new Date().toISOString(),
	}, 200);
}
