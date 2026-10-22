import type { APIRoute } from 'astro';
import { handler } from '../../../backend/handlers/health.js';
import { invokeApiHandler, methodNotAllowed } from '../../lib/api-route.js';

export const prerender = false;
export const GET: APIRoute = ({ request }) => invokeApiHandler(request, handler);
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
