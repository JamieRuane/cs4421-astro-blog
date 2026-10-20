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

type MovieResponse = {
	page: number;
	totalPages: number;
	genres: Genre[];
	results: Movie[];
};

function isGenre(value: unknown): value is Genre {
	if (typeof value !== 'object' || value === null) return false;
	const genre = value as Record<string, unknown>;
	return Number.isInteger(genre.id) && typeof genre.name === 'string';
}

function isMovie(value: unknown): value is Movie {
	if (typeof value !== 'object' || value === null) return false;
	const movie = value as Record<string, unknown>;
	return (
		Number.isInteger(movie.id) &&
		typeof movie.title === 'string' &&
		typeof movie.releaseDate === 'string' &&
		typeof movie.overview === 'string' &&
		(movie.posterPath === null || typeof movie.posterPath === 'string') &&
		typeof movie.voteAverage === 'number' &&
		Number.isFinite(movie.voteAverage) &&
		Array.isArray(movie.genreIds) &&
		movie.genreIds.every((id) => Number.isInteger(id))
	);
}

function isMovieResponse(value: unknown): value is MovieResponse {
	if (typeof value !== 'object' || value === null) return false;
	const response = value as Record<string, unknown>;
	return (
		Number.isInteger(response.page) &&
		Number.isInteger(response.totalPages) &&
		Array.isArray(response.genres) &&
		response.genres.every(isGenre) &&
		Array.isArray(response.results) &&
		response.results.every(isMovie)
	);
}

function releaseYear(releaseDate: string): string {
	const match = /^(\d{4})-\d{2}-\d{2}$/.exec(releaseDate);
	return match?.[1] ?? 'Release date unknown';
}

function requireElement<T extends Element>(element: T | null, name: string): T {
	if (!element) throw new Error(`Movies search markup is missing ${name}.`);
	return element;
}

const form = requireElement(
	document.querySelector<HTMLFormElement>('[data-movie-search]'),
	'search form',
);
const results = requireElement(
	document.querySelector<HTMLElement>('[data-movie-results]'),
	'results container',
);
const statusElement = requireElement(
	document.querySelector<HTMLElement>('[data-movie-status]'),
	'status message',
);
const moreButton = requireElement(
	document.querySelector<HTMLButtonElement>('[data-movie-more]'),
	'pagination button',
);
const queryInput = requireElement(
	form.querySelector<HTMLInputElement>('input[name="query"]'),
	'title input',
);
const genreSelect = requireElement(
	form.querySelector<HTMLSelectElement>('select[name="genre"]'),
	'genre filter',
);
const yearInput = requireElement(
	form.querySelector<HTMLInputElement>('input[name="year"]'),
	'year filter',
);
const submitButton = requireElement(
	form.querySelector<HTMLButtonElement>('[type="submit"]'),
	'submit button',
);

let currentPage = 1;
let totalPages = 1;
let genreNames = new Map<number, string>();
let requestSequence = 0;

function updateGenres(genres: Genre[]): void {
	const selected = genreSelect.value;
	genreNames = new Map(genres.map((genre) => [genre.id, genre.name]));
	genreSelect.replaceChildren(new Option('Any genre', ''));
	genres
		.slice()
		.sort((left, right) => left.name.localeCompare(right.name))
		.forEach((genre) => genreSelect.add(new Option(genre.name, String(genre.id))));
	if (genres.some((genre) => String(genre.id) === selected)) {
		genreSelect.value = selected;
	}
}

function createMovieCard(movie: Movie): HTMLElement {
	const card = document.createElement('article');
	const poster = document.createElement('div');
	const copy = document.createElement('div');
	const heading = document.createElement('h2');
	const titleLink = document.createElement('a');
	const meta = document.createElement('div');
	const year = document.createElement('span');
	const rating = document.createElement('span');
	const overview = document.createElement('p');

	card.className = 'movie-card';
	poster.className = 'movie-poster';
	copy.className = 'movie-copy';
	heading.className = 'movie-title';
	meta.className = 'movie-meta';
	year.textContent = releaseYear(movie.releaseDate);
	rating.className = 'movie-rating';
	rating.textContent = `TMDB rating ${movie.voteAverage.toFixed(1)} out of 10`;
	titleLink.href = `https://www.themoviedb.org/movie/${movie.id}`;
	titleLink.target = '_blank';
	titleLink.rel = 'noopener noreferrer';
	titleLink.textContent = movie.title;
	titleLink.setAttribute('aria-label', `${movie.title} on TMDB, opens in a new tab`);
	heading.append(titleLink);
	meta.append(year, rating);

	if (movie.posterPath) {
		const image = document.createElement('img');
		image.src = `https://image.tmdb.org/t/p/w342${movie.posterPath}`;
		image.alt = `Poster for ${movie.title}`;
		image.loading = 'lazy';
		image.decoding = 'async';
		poster.append(image);
	} else {
		const placeholder = document.createElement('span');
		placeholder.className = 'poster-placeholder';
		placeholder.textContent = 'Poster unavailable';
		poster.append(placeholder);
	}

	if (movie.overview) {
		overview.className = 'movie-overview';
		overview.textContent = movie.overview;
		copy.append(overview);
	}

	const movieGenres = movie.genreIds
		.map((id) => genreNames.get(id))
		.filter((name): name is string => name !== undefined);
	if (movieGenres.length > 0) {
		const list = document.createElement('ul');
		list.className = 'movie-genres';
		list.setAttribute('aria-label', 'Genres');
		movieGenres.forEach((name) => {
			const item = document.createElement('li');
			item.textContent = name;
			list.append(item);
		});
		copy.append(list);
	}

	copy.prepend(heading, meta);
	card.append(poster, copy);
	return card;
}

async function loadMovies(page: number, append: boolean): Promise<void> {
	const sequence = ++requestSequence;
	const params = new URLSearchParams();
	const query = queryInput.value.trim();
	const genre = genreSelect.value;
	const year = yearInput.value.trim();

	if (query) params.set('query', query);
	if (genre) params.set('genre', genre);
	if (year) params.set('year', year);
	params.set('page', String(page));

	statusElement.dataset.error = 'false';
	statusElement.textContent = 'Finding films…';
	submitButton.disabled = true;
	moreButton.disabled = true;
	if (!append) results.replaceChildren();

	try {
		const response = await fetch(`/api/movies?${params.toString()}`, {
			headers: { accept: 'application/json' },
		});
		const payload: unknown = await response.json();
		if (!response.ok) {
			const message = typeof payload === 'object' && payload !== null &&
				typeof (payload as Record<string, unknown>).error === 'string'
				? (payload as { error: string }).error
				: 'Movie information is temporarily unavailable. Please try again.';
			throw new Error(message);
		}
		if (!isMovieResponse(payload)) {
			throw new Error('Movie information could not be read. Please try again.');
		}
		if (sequence !== requestSequence) return;

		updateGenres(payload.genres);
		currentPage = payload.page;
		totalPages = payload.totalPages;
		payload.results.forEach((movie) => results.append(createMovieCard(movie)));
		if (payload.results.length === 0 && !append) {
			statusElement.textContent = query
				? `No films found for “${query}”. Try another title or clear a filter.`
				: 'No films match those filters. Try a different year or genre.';
		} else {
			statusElement.textContent = query
				? `Showing ${results.childElementCount} ${results.childElementCount === 1 ? 'result' : 'results'} for “${query}”.`
				: `Popular films${genre || year ? ' matching your filters' : ''}.`;
		}
		moreButton.hidden = currentPage >= totalPages || payload.results.length === 0;
	} catch (error) {
		if (sequence !== requestSequence) return;
		statusElement.dataset.error = 'true';
		statusElement.textContent = error instanceof Error
			? error.message
			: 'Movie information is temporarily unavailable. Please try again.';
		moreButton.hidden = true;
	} finally {
		if (sequence === requestSequence) {
			submitButton.disabled = false;
			moreButton.disabled = false;
		}
	}
}

form.addEventListener('submit', (event) => {
	event.preventDefault();
	void loadMovies(1, false);
});

form.addEventListener('reset', () => {
	window.setTimeout(() => void loadMovies(1, false), 0);
});

moreButton.addEventListener('click', () => {
	void loadMovies(currentPage + 1, true);
});

void loadMovies(1, false);
