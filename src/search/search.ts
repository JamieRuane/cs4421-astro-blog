export interface BlogSearchEntry {
	id: string;
	title: string;
	description: string;
}

export interface SearchItem {
	title: string;
	type: 'Blog post' | 'Game' | 'Section';
	description: string;
	url: string;
}

const STATIC_ITEMS: SearchItem[] = [
	{
		title: 'Dino Run',
		type: 'Game',
		description: 'Jump obstacles and see how long you can last.',
		url: '/games/#dino-run',
	},
	{
		title: 'About Me Hangman',
		type: 'Game',
		description: 'Guess a word about my interests, one letter at a time.',
		url: '/games/#hangman',
	},
	{
		title: 'Wordle',
		type: 'Game',
		description: 'Find the five-letter word in six guesses.',
		url: '/games/#wordle',
	},
	{
		title: 'My Ideas',
		type: 'Section',
		description: 'Browse blogs, games, music and movies.',
		url: '/my-ideas/',
	},
	{
		title: 'Music',
		type: 'Section',
		description: 'Explore artists, tracks and sounds.',
		url: '/music/',
	},
	{
		title: 'Movies',
		type: 'Section',
		description: 'Explore films, classics and new discoveries.',
		url: '/movies/',
	},
	{
		title: 'My Place',
		type: 'Section',
		description: 'Visit my place and see the local weather.',
		url: '/about/',
	},
];

function normalize(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLocaleLowerCase()
		.trim();
}

function words(value: string): string[] {
	return normalize(value).split(/[^\p{Letter}\p{Number}]+/u).filter(Boolean);
}

function scoreTerm(term: string, title: string, description: string, type: string): number {
	const normalizedTitle = normalize(title);
	const titleWords = words(title);
	const descriptionWords = words(description);
	const typeWords = words(type);

	if (normalizedTitle === term) return 12;
	if (titleWords.some((word) => word === term)) return 10;
	if (titleWords.some((word) => word.startsWith(term))) return 8;
	if (titleWords.some((word) => word.includes(term))) return 6;
	if (descriptionWords.some((word) => word === term)) return 5;
	if (descriptionWords.some((word) => word.startsWith(term))) return 4;
	if (descriptionWords.some((word) => word.includes(term))) return 3;
	if (typeWords.some((word) => word === term)) return 2;
	if (typeWords.some((word) => word.startsWith(term) || word.includes(term))) return 1;
	return 0;
}

export function buildSearchIndex(posts: readonly BlogSearchEntry[]): SearchItem[] {
	const blogItems = posts.map((post) => ({
		title: post.title,
		type: 'Blog post' as const,
		description: post.description,
		url: `/blog/${post.id}/`,
	}));

	return [...blogItems, ...STATIC_ITEMS];
}

export function searchItems(items: readonly SearchItem[], query: string): SearchItem[] {
	const queryWords = words(query);
	if (queryWords.length === 0) {
		return [];
	}

	return items
		.map((item, index) => {
			const scores = queryWords.map((term) =>
				scoreTerm(term, item.title, item.description, item.type),
			);
			return {
				item,
				index,
				score: scores.every((score) => score > 0) ? scores.reduce((sum, score) => sum + score, 0) : 0,
			};
		})
		.filter((result) => result.score > 0)
		.sort((first, second) => second.score - first.score || first.index - second.index)
		.map((result) => result.item);
}
