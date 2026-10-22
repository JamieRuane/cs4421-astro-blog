import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createMoviesHandler,
	parseTmdbAccessToken,
	parseMovieQuery,
} from '../backend/handlers/movies';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

const token = 'tmdb-read-token-for-tests';

function event(queryStringParameters?: Record<string, string>) {
	return { queryStringParameters };
}

function tmdbGenres() {
	return new Response(JSON.stringify({
		genres: [
			{ id: 18, name: 'Drama' },
			{ id: 35, name: 'Comedy' },
		],
	}));
}

function tmdbMovies() {
	return new Response(JSON.stringify({
		page: 1,
		total_pages: 3,
		results: [
			{
				id: 123,
				title: 'A Test Film',
				release_date: '2020-04-03',
				overview: 'A short description.',
				poster_path: '/poster.jpg',
				vote_average: 8.25,
				genre_ids: [18],
			},
		],
	}));
}

describe('movie query validation', () => {
	it('trims title queries and accepts supported filters', () => {
		expect(parseMovieQuery({
			query: '  Film title  ',
			genre: '18',
			year: '2020',
			page: '2',
		})).toEqual({
			value: { query: 'Film title', genreId: 18, year: 2020, page: 2 },
		});
	});

	it('rejects invalid query, genre, year, and page values', () => {
		expect(parseMovieQuery({ query: 'x'.repeat(101) })).toHaveProperty('error');
		expect(parseMovieQuery({ genre: '18.5' })).toHaveProperty('error');
		expect(parseMovieQuery({ year: '20xx' })).toHaveProperty('error');
		expect(parseMovieQuery({ year: '1800' })).toHaveProperty('error');
		expect(parseMovieQuery({ page: '501' })).toHaveProperty('error');
	});

	it('uses popular movies when the search query is empty', () => {
		expect(parseMovieQuery({ query: '  ' })).toEqual({
			value: { page: 1 },
		});
	});
});

describe('TMDB access token parsing', () => {
	it('extracts the token from a Secrets Manager key/value secret', () => {
		expect(parseTmdbAccessToken('{"token":"tmdb-read-token-for-tests"}')).toBe(token);
	});

	it('continues to accept plaintext tokens, with or without a Bearer prefix', () => {
		expect(parseTmdbAccessToken(token)).toBe(token);
		expect(parseTmdbAccessToken(`Bearer ${token}`)).toBe(token);
	});

	it('rejects missing or invalid structured secret values', () => {
		expect(() => parseTmdbAccessToken(undefined)).toThrow();
		expect(() => parseTmdbAccessToken('{"other":"value"}')).toThrow();
		expect(() => parseTmdbAccessToken('{invalid json')).toThrow();
	});
});

describe('movie Lambda handler', () => {
	it('returns popular movies and genres without exposing the access token', async () => {
		const fetcher = vi.fn<typeof fetch>(async (input) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			return url.pathname.endsWith('/genre/movie/list') ? tmdbGenres() : tmdbMovies();
		});
		const handler = createMoviesHandler({ fetcher, getAccessToken: async () => token });

		const response = await handler(event());

		expect(response.statusCode).toBe(200);
		expect(response.headers['cache-control']).toContain('max-age=300');
		expect(response.body).not.toContain(token);
		expect(JSON.parse(response.body)).toMatchObject({
			page: 1,
			totalPages: 3,
			genres: [
				{ id: 18, name: 'Drama' },
				{ id: 35, name: 'Comedy' },
			],
			results: [{
				id: 123,
				title: 'A Test Film',
				releaseDate: '2020-04-03',
				posterPath: '/poster.jpg',
				voteAverage: 8.25,
				genreIds: [18],
			}],
		});
		expect(fetcher).toHaveBeenCalledTimes(2);
		const movieRequest = fetcher.mock.calls.find(([input]) =>
			String(input).includes('/movie/popular'),
		);
		expect(movieRequest).toBeDefined();
		expect(new Headers(movieRequest?.[1]?.headers).get('authorization')).toBe(`Bearer ${token}`);
	});

	it('searches by title, applies year and genre filters, and caches genres', async () => {
		const fetcher = vi.fn<typeof fetch>(async (input) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			return url.pathname.endsWith('/genre/movie/list') ? tmdbGenres() : tmdbMovies();
		});
		const handler = createMoviesHandler({ fetcher, getAccessToken: async () => token });
		const response = await handler(event({
			query: 'Test Film',
			genre: '18',
			year: '2020',
		}));

		expect(response.statusCode).toBe(200);
		const searchRequest = fetcher.mock.calls.find(([input]) =>
			String(input).includes('/search/movie'),
		);
		const searchUrl = new URL(String(searchRequest?.[0]));
		expect(searchUrl.searchParams.get('query')).toBe('Test Film');
		expect(searchUrl.searchParams.get('year')).toBe('2020');
		expect(JSON.parse(response.body).results).toHaveLength(1);

		await handler(event({ query: 'Another film' }));
		expect(fetcher.mock.calls.filter(([input]) =>
			String(input).includes('/genre/movie/list'),
		)).toHaveLength(1);
	});

	it('rejects invalid input without calling TMDB', async () => {
		const fetcher = vi.fn<typeof fetch>();
		const handler = createMoviesHandler({ fetcher, getAccessToken: async () => token });

		const response = await handler(event({ query: 'x'.repeat(101) }));

		expect(response.statusCode).toBe(400);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('returns a safe unavailable response when the TMDB API fails', async () => {
		const fetcher: typeof fetch = vi.fn(async () =>
			new Response('private upstream details', { status: 503 }),
		);
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const handler = createMoviesHandler({ fetcher, getAccessToken: async () => token });

		const response = await handler(event());

		expect(response.statusCode).toBe(502);
		expect(JSON.parse(response.body)).toEqual({
			status: 'error',
			error: 'Movie information is temporarily unavailable. Please try again.',
		});
		expect(response.body).not.toContain(token);
		expect(response.body).not.toContain('private upstream details');
		expect(errorLog).toHaveBeenCalledOnce();
		expect(errorLog.mock.calls[0][0]).not.toContain(token);
	});

	it('returns a safe timeout response and rate-limits as unavailable', async () => {
		const timeoutFetcher: typeof fetch = vi.fn(async () => {
			throw new DOMException('Timed out', 'TimeoutError');
		});
		const timeoutHandler = createMoviesHandler({
			fetcher: timeoutFetcher,
			getAccessToken: async () => token,
		});
		expect((await timeoutHandler(event()).then((response) => response.statusCode))).toBe(504);

		const rateLimitedFetcher: typeof fetch = vi.fn(async () =>
			new Response('', { status: 429 }),
		);
		const rateLimitedHandler = createMoviesHandler({
			fetcher: rateLimitedFetcher,
			getAccessToken: async () => token,
		});
		expect((await rateLimitedHandler(event()).then((response) => response.statusCode))).toBe(503);
	});

	it('reports missing credentials without making an upstream request', async () => {
		const fetcher = vi.fn<typeof fetch>();
		vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', '');
		vi.stubEnv('TMDB_API_SECRET_ARN', '');
		const handler = createMoviesHandler({ fetcher });

		const response = await handler(event());

		expect(response.statusCode).toBe(503);
		expect(JSON.parse(response.body).error).toBe('Movie search is not configured.');
		expect(fetcher).not.toHaveBeenCalled();
	});
});
