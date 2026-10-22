import {
	GetSecretValueCommand,
	SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { jsonResponse, type HttpApiEvent, type HttpApiResponse } from './http.js';

const tmdbBaseUrl = 'https://api.themoviedb.org/3';
const responseCache = 'public, max-age=300, s-maxage=0';

type Genre = {
	id: number;
	name: string;
};

type Movie = {
	id: number;
	title: string;
	releaseDate: string;
	overview: string;
	posterPath: string | null;
	voteAverage: number;
	genreIds: number[];
};

type MovieQuery = {
	query?: string;
	genreId?: number;
	year?: number;
	page: number;
};

type ParsedQuery =
	| { value: MovieQuery }
	| { error: string };

type TmdbResponse = {
	page?: unknown;
	total_pages?: unknown;
	results?: unknown;
};

type HandlerDependencies = {
	fetcher?: typeof fetch;
	getAccessToken?: () => Promise<string>;
};

class TmdbHttpError extends Error {
	constructor(readonly status: number) {
		super('TMDB request failed');
	}
}

class MissingTmdbTokenError extends Error {}

export function parseTmdbAccessToken(secretString: string | undefined): string {
	const secretValue = secretString?.trim();
	if (!secretValue) throw new MissingTmdbTokenError();

	let token = secretValue;
	if (secretValue.startsWith('{')) {
		let secret: unknown;
		try {
			secret = JSON.parse(secretValue) as unknown;
		} catch {
			throw new MissingTmdbTokenError();
		}
		if (
			typeof secret !== 'object' ||
			secret === null ||
			typeof (secret as Record<string, unknown>).token !== 'string'
		) {
			throw new MissingTmdbTokenError();
		}
		token = (secret as { token: string }).token.trim();
	}

	const accessToken = token.replace(/^Bearer\s+/i, '').trim();
	if (!accessToken) throw new MissingTmdbTokenError();
	return accessToken;
}

function parseInteger(value: string | undefined): number | undefined {
	if (value === undefined || value.trim() === '') return undefined;
	if (!/^\d+$/.test(value)) return Number.NaN;
	return Number(value);
}

export function parseMovieQuery(
	parameters: Record<string, string | undefined> | null | undefined,
): ParsedQuery {
	const values = parameters ?? {};
	const query = values.query?.trim();
	if (query && query.length > 100) {
		return { error: 'Search terms must be 100 characters or fewer.' };
	}

	const genreId = parseInteger(values.genre);
	if (Number.isNaN(genreId) || (genreId !== undefined && (genreId < 1 || genreId > 100_000))) {
		return { error: 'Choose a valid movie genre.' };
	}

	const year = parseInteger(values.year);
	const currentYear = new Date().getFullYear();
	if (
		Number.isNaN(year) ||
		(year !== undefined && (year < 1888 || year > currentYear + 10))
	) {
		return { error: 'Enter a valid release year.' };
	}

	const page = parseInteger(values.page) ?? 1;
	if (!Number.isInteger(page) || page < 1 || page > 500) {
		return { error: 'Page must be between 1 and 500.' };
	}

	return {
		value: {
			...(query ? { query } : {}),
			...(genreId ? { genreId } : {}),
			...(year ? { year } : {}),
			page,
		},
	};
}

function isGenre(value: unknown): value is Genre {
	if (typeof value !== 'object' || value === null) return false;
	const genre = value as Record<string, unknown>;
	return Number.isInteger(genre.id) && typeof genre.name === 'string';
}

function mapMovie(value: unknown): Movie | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const movie = value as Record<string, unknown>;
	if (
		!Number.isInteger(movie.id) ||
		typeof movie.title !== 'string' ||
		typeof movie.overview !== 'string' ||
		typeof movie.vote_average !== 'number' ||
		!Number.isFinite(movie.vote_average) ||
		!Array.isArray(movie.genre_ids) ||
		!movie.genre_ids.every((id) => Number.isInteger(id)) ||
		!(movie.poster_path === null || typeof movie.poster_path === 'string') ||
		typeof movie.release_date !== 'string'
	) {
		return undefined;
	}

	const posterPath = typeof movie.poster_path === 'string'
		&& movie.poster_path.startsWith('/')
		&& !movie.poster_path.includes('..')
		? movie.poster_path
		: null;

	return {
		id: movie.id as number,
		title: movie.title,
		releaseDate: movie.release_date,
		overview: movie.overview,
		posterPath,
		voteAverage: movie.vote_average,
		genreIds: movie.genre_ids as number[],
	};
}

function getSecretsManagerTokenProvider(): () => Promise<string> {
	const client = new SecretsManagerClient({});
	let cachedToken: { secretId: string; value: string; expiresAt: number } | undefined;

	return async () => {
		const localToken = process.env.TMDB_API_READ_ACCESS_TOKEN;
		if (localToken?.trim()) return parseTmdbAccessToken(localToken);

		const secretId = process.env.TMDB_API_SECRET_ARN;
		if (!secretId) throw new MissingTmdbTokenError();

		if (cachedToken?.secretId === secretId && cachedToken.expiresAt > Date.now()) {
			return cachedToken.value;
		}

		const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
		const token = parseTmdbAccessToken(result.SecretString);

		cachedToken = { secretId, value: token, expiresAt: Date.now() + 300_000 };
		return token;
	};
}

export function createMoviesHandler({
	fetcher = fetch,
	getAccessToken = getSecretsManagerTokenProvider(),
}: HandlerDependencies = {}): (event: HttpApiEvent) => Promise<HttpApiResponse> {
	let cachedGenres: { genres: Genre[]; expiresAt: number } | undefined;

	async function requestJson(url: URL, token: string): Promise<unknown> {
		const response = await fetcher(url, {
			headers: {
				accept: 'application/json',
				authorization: `Bearer ${token}`,
			},
			signal: AbortSignal.timeout(8_000),
		});
		if (!response.ok) throw new TmdbHttpError(response.status);
		return response.json() as Promise<unknown>;
	}

	async function loadGenres(token: string): Promise<Genre[]> {
		if (cachedGenres && cachedGenres.expiresAt > Date.now()) return cachedGenres.genres;

		const url = new URL(`${tmdbBaseUrl}/genre/movie/list`);
		url.searchParams.set('language', 'en-US');
		const response = await requestJson(url, token);
		if (
			typeof response !== 'object' ||
			response === null ||
			!Array.isArray((response as Record<string, unknown>).genres)
		) {
			throw new Error('Invalid TMDB genre response');
		}

		const genres = ((response as { genres: unknown[] }).genres).filter(isGenre);
		cachedGenres = { genres, expiresAt: Date.now() + 3_600_000 };
		return genres;
	}

	return async (event) => {
		const parsed = parseMovieQuery(event.queryStringParameters);
		if ('error' in parsed) {
			return jsonResponse({ status: 'error', error: parsed.error }, 400);
		}

		try {
			const token = await getAccessToken();
			const url = new URL(
				parsed.value.query
					? `${tmdbBaseUrl}/search/movie`
					: parsed.value.genreId || parsed.value.year
						? `${tmdbBaseUrl}/discover/movie`
						: `${tmdbBaseUrl}/movie/popular`,
			);
			url.searchParams.set('language', 'en-US');
			url.searchParams.set('include_adult', 'false');
			url.searchParams.set('page', String(parsed.value.page));

			if (parsed.value.query) {
				url.searchParams.set('query', parsed.value.query);
				if (parsed.value.year) url.searchParams.set('year', String(parsed.value.year));
			} else if (parsed.value.genreId || parsed.value.year) {
				url.searchParams.set('sort_by', 'popularity.desc');
				if (parsed.value.genreId) url.searchParams.set('with_genres', String(parsed.value.genreId));
				if (parsed.value.year) url.searchParams.set('primary_release_year', String(parsed.value.year));
			}

			const [rawMovies, genres] = await Promise.all([
				requestJson(url, token),
				loadGenres(token),
			]);
			if (
				typeof rawMovies !== 'object' ||
				rawMovies === null ||
				!Array.isArray((rawMovies as TmdbResponse).results)
			) {
				throw new Error('Invalid TMDB movie response');
			}

			let movies = ((rawMovies as { results: unknown[] }).results)
				.map(mapMovie)
				.filter((movie): movie is Movie => movie !== undefined);
			const requestedGenreId = parsed.value.genreId;
			if (parsed.value.query && requestedGenreId) {
				movies = movies.filter((movie) => movie.genreIds.includes(requestedGenreId));
			}

			return jsonResponse(
				{
					page: parsed.value.page,
					totalPages: Number.isInteger((rawMovies as TmdbResponse).total_pages)
						? Math.min((rawMovies as { total_pages: number }).total_pages, 500)
						: 1,
					genres,
					results: movies,
				},
				200,
				responseCache,
			);
		} catch (error) {
			const isTimeout = error instanceof Error &&
				(error.name === 'TimeoutError' || error.name === 'AbortError');
			const statusCode = error instanceof MissingTmdbTokenError
				? 503
				: isTimeout
					? 504
					: error instanceof TmdbHttpError && error.status === 429
						? 503
						: 502;
			console.error(JSON.stringify({
				level: 'error',
				event: 'movies.request_failed',
				statusCode,
				upstreamStatus: error instanceof TmdbHttpError ? error.status : undefined,
			}));
			return jsonResponse(
				{
					status: 'error',
					error: error instanceof MissingTmdbTokenError
						? 'Movie search is not configured.'
						: isTimeout
							? 'The movie service took too long to respond. Please try again.'
							: 'Movie information is temporarily unavailable. Please try again.',
				},
				statusCode,
			);
		}
	};
}

export const handler = createMoviesHandler();
