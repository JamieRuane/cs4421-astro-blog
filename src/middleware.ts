import type { MiddlewareHandler } from 'astro';

export const onRequest: MiddlewareHandler = async ({ request }, next) => {
	const started = performance.now();
	let response: Response | undefined;
	let errorType: string | undefined;

	try {
		response = await next();
		return response;
	} catch (error) {
		errorType = error instanceof Error ? error.name : 'UnknownError';
		throw error;
	} finally {
		const pathname = new URL(request.url).pathname;
		console.log(JSON.stringify({
			timestamp: new Date().toISOString(),
			level: errorType ? 'ERROR' : 'INFO',
			route: pathname,
			method: request.method,
			statusCode: response?.status ?? (errorType ? 500 : 200),
			latencyMs: Math.round(performance.now() - started),
			...(errorType ? { errorType } : {}),
		}));
	}
};
