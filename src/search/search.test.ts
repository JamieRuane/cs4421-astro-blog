import { describe, expect, it } from 'vitest';
import { buildSearchIndex, searchItems, type BlogSearchEntry } from './search';

const blogPosts: BlogSearchEntry[] = [
	{
		id: 'second-post',
		title: 'Second post: Freddie',
		description: 'A little about Freddie, my two-year-old golden retriever.',
	},
	{
		id: 'third-post',
		title: 'Third post: Blogs',
		description: 'Why I enjoy reading and creating blogs.',
	},
];

describe('site search', () => {
	const index = buildSearchIndex(blogPosts);

	it('returns no results for empty or whitespace-only input', () => {
		expect(searchItems(index, '')).toEqual([]);
		expect(searchItems(index, '   \t ')).toEqual([]);
	});

	it('matches titles and descriptions case-insensitively with partial words', () => {
		expect(searchItems(index, 'FREDD')).toContainEqual(
			expect.objectContaining({ title: 'Second post: Freddie', url: '/blog/second-post/' }),
		);
		expect(searchItems(index, 'GOLDEN RETR')).toContainEqual(
			expect.objectContaining({ title: 'Second post: Freddie' }),
		);
	});

	it('ranks an exact title match before a description-only match', () => {
		const results = searchItems(index, 'blogs');

		expect(results[0]).toMatchObject({ title: 'Third post: Blogs', url: '/blog/third-post/' });
		expect(results.find((result) => result.title === 'My Ideas')).toBeDefined();
	});

	it('generates blog routes from content entry IDs, not duplicated post metadata', () => {
		const blogResults = index.filter((item) => item.type === 'Blog post');

		expect(blogResults.map((item) => item.url)).toEqual([
			'/blog/second-post/',
			'/blog/third-post/',
		]);
	});

	it('includes direct links for the games and other site sections', () => {
		const games = searchItems(index, 'game');
		expect(games.filter((item) => item.type === 'Game').map((item) => item.url)).toEqual([
			'/games/#dino-run',
			'/games/#hangman',
			'/games/#wordle',
		]);

		expect(searchItems(index, 'music')[0]).toMatchObject({ title: 'Music', url: '/music/' });
		expect(searchItems(index, 'movies')[0]).toMatchObject({ title: 'Movies', url: '/movies/' });
		expect(searchItems(index, 'my place')[0]).toMatchObject({ title: 'My Place', url: '/about/' });
		expect(searchItems(index, 'reliability')[0]).toMatchObject({
			title: 'Reliability',
			type: 'Section',
			url: '/reliability/',
		});
	});
});
