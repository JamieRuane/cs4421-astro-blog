import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

async function readTextFiles(directory, extension) {
	const entries = await readdir(directory, { withFileTypes: true });
	const contents = await Promise.all(
		entries.map(async (entry) => {
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) return readTextFiles(entryPath, extension);
			if (entry.isFile() && entry.name.endsWith(extension)) return readFile(entryPath, 'utf8');
			return '';
		}),
	);

	return contents.flat(Infinity).join('\n');
}

const serverBundle = await readTextFiles(path.join(root, 'dist', 'server'), '.mjs');
assert.match(
	serverBundle,
	/This website uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB\./,
	'The generated Movies server bundle must include TMDB attribution.',
);
assert.match(
	serverBundle,
	/\/tmdb-blue-long\.svg/,
	'The generated Movies server bundle must include the approved TMDB logo.',
);

const logo = await readFile(path.join(root, 'dist', 'client', 'tmdb-blue-long.svg'), 'utf8');
assert.match(logo, /^<svg\b/, 'The deployed TMDB logo must be an SVG asset.');

const policy = JSON.parse(await readFile(path.join(root, 'security-policy.json'), 'utf8'));
assert.ok(
	policy.headers['Content-Security-Policy']['img-src'].includes('https://image.tmdb.org'),
	'The CSP must allow TMDB poster images.',
);

const bundle = await readTextFiles(path.join(root, 'dist', 'client', '_astro'), '.js');
assert.ok(bundle.includes('/api/movies'), 'The generated page must call the same-origin Movies API.');
assert.ok(
	bundle.includes('image.tmdb.org/t/p/w342'),
	'Movie posters must use the expected TMDB image origin and size.',
);

console.log('Movies route, attribution, logo, CSP image origin, API path, and poster URL validated.');
