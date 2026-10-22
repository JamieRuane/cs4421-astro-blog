import type { APIRoute } from 'astro';
import { handler } from '../../../backend/handlers/feedback.js';
import { invokeApiHandler, methodNotAllowed } from '../../lib/api-route.js';

export const prerender = false;
export const POST: APIRoute = ({ request }) => invokeApiHandler(request, handler);
export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
