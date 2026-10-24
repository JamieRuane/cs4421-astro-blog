import type { APIRoute } from 'astro';
import { createMoviesHandler, createTmdbTokenProvider } from '../../../backend/handlers/movies.js';
import { invokeApiHandler, methodNotAllowed } from '../../lib/api-route.js';

export const prerender = false;
const moviesHandler = createMoviesHandler({
	getAccessToken: createTmdbTokenProvider({
		TMDB_API_READ_ACCESS_TOKEN:
			import.meta.env.TMDB_API_READ_ACCESS_TOKEN ?? process.env.TMDB_API_READ_ACCESS_TOKEN,
		TMDB_API_SECRET_ARN: process.env.TMDB_API_SECRET_ARN,
	}),
});

export const GET: APIRoute = ({ request }) => invokeApiHandler(request, moviesHandler);
export const POST = methodNotAllowed;
