import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const html = await readFile(path.join(root, 'dist', 'movies', 'index.html'), 'utf8');
assert.match(
	html,
	/This website uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB\./,
	'The Movies page must include TMDB attribution.',
);
assert.match(html, /\/tmdb-blue-long\.svg/, 'The Movies page must include the approved TMDB logo.');

const logo = await readFile(path.join(root, 'dist', 'tmdb-blue-long.svg'), 'utf8');
assert.match(logo, /^<svg\b/, 'The deployed TMDB logo must be an SVG asset.');

const policy = JSON.parse(await readFile(path.join(root, 'security-policy.json'), 'utf8'));
assert.ok(
	policy.headers['Content-Security-Policy']['img-src'].includes('https://image.tmdb.org'),
	'The CSP must allow TMDB poster images.',
);

const assetsDirectory = path.join(root, 'dist', '_astro');
const assets = await readdir(assetsDirectory, { withFileTypes: true });
const scripts = await Promise.all(
	assets
		.filter((asset) => asset.isFile() && asset.name.endsWith('.js'))
		.map((asset) => readFile(path.join(assetsDirectory, asset.name), 'utf8')),
);
const bundle = scripts.join('\n');
assert.ok(bundle.includes('/api/movies'), 'The generated page must call the same-origin Movies API.');
assert.ok(
	bundle.includes('image.tmdb.org/t/p/w342'),
	'Movie posters must use the expected TMDB image origin and size.',
);

console.log('Movies route, attribution, logo, CSP image origin, API path, and poster URL validated.');
