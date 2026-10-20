export type HttpApiEvent = {
	version?: string;
	routeKey?: string;
	rawPath?: string;
	headers?: Record<string, string | undefined>;
	body?: string | null;
	isBase64Encoded?: boolean;
	requestContext?: {
		requestId?: string;
		http?: {
			method?: string;
			path?: string;
		};
	};
};

export type HttpApiResponse = {
	statusCode: number;
	headers: Record<string, string>;
	body: string;
};

export function jsonResponse(
	body: Record<string, unknown>,
	statusCode: number,
	cacheControl = 'no-store',
): HttpApiResponse {
	return {
		statusCode,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': cacheControl,
		},
		body: JSON.stringify(body),
	};
}

export function getHeader(
	headers: Record<string, string | undefined> | undefined,
	name: string,
): string | undefined {
	return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}

export function getRequestBody(event: HttpApiEvent): string {
	if (!event.body) return '';
	return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
}
