import type { APIRoute } from 'astro';
import { createReliabilityHandler } from '../../../backend/handlers/reliability.js';
import { invokeApiHandler, methodNotAllowed } from '../../lib/api-route.js';

export const prerender = false;
const reliabilityHandler = createReliabilityHandler({
	environment: {
		AWS_REGION: import.meta.env.AWS_REGION ?? process.env.AWS_REGION ?? 'eu-west-1',
		API_ID: import.meta.env.API_ID ?? process.env.API_ID,
		API_STAGE: import.meta.env.API_STAGE ?? process.env.API_STAGE,
		SLO_AVAILABILITY_TARGET:
			import.meta.env.SLO_AVAILABILITY_TARGET ?? process.env.SLO_AVAILABILITY_TARGET,
		SLO_API_LATENCY_P95_TARGET_MS:
			import.meta.env.SLO_API_LATENCY_P95_TARGET_MS ?? process.env.SLO_API_LATENCY_P95_TARGET_MS,
	},
});

export const GET: APIRoute = ({ request }) => invokeApiHandler(request, reliabilityHandler);
export const POST = methodNotAllowed;
