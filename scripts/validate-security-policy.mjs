import { createHash } from 'node:crypto';
import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildRoot = join(projectRoot, 'dist');
const policyPath = join(projectRoot, 'security-policy.json');
const errors = [];

function fail(message) {
    errors.push(message);
}

async function listFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nestedFiles = await Promise.all(
        entries.map((entry) => {
            const path = join(directory, entry.name);
            return entry.isDirectory() ? listFiles(path) : path;
        }),
    );
    return nestedFiles.flat();
}

function hashSource(content) {
    const digest = createHash('sha256').update(content, 'utf8').digest('base64');
    return `'sha256-${digest}'`;
}

function parseAttributes(source) {
    const attributes = new Map();
    const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    for (const match of source.matchAll(pattern)) {
        attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
    }
    return attributes;
}

function sourceListFor(directives, directive) {
    if (directives[directive]) return directives[directive];
    if (directive === 'frame-src' && directives['child-src']) return directives['child-src'];
    return directives['default-src'] ?? [];
}

function allowsResource(resource, sources) {
    let url;
    try {
        url = new URL(resource, 'https://csp-self.invalid');
    } catch {
        return false;
    }

    if (url.origin === 'https://csp-self.invalid') return sources.includes("'self'");
    if (url.protocol === 'data:' || url.protocol === 'blob:') {
        return sources.includes(url.protocol);
    }

    return sources.some((source) => {
        if (source === url.protocol) return true;
        if (!/^https?:\/\//i.test(source)) return false;
        try {
            const sourceUrl = new URL(source);
            return sourceUrl.origin === url.origin
                && (sourceUrl.pathname === '/' || url.pathname.startsWith(sourceUrl.pathname));
        } catch {
            return false;
        }
    });
}

function checkResource(resource, directive, directives, context) {
    if (!resource || resource.startsWith('#')) return;
    if (!allowsResource(resource, sourceListFor(directives, directive))) {
        fail(`${context}: ${resource} is not allowed by ${directive}`);
    }
}

function checkHtml(html, file, directives, hashes) {
    const inlineBlocks = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
    for (const match of html.matchAll(inlineBlocks)) {
        const [, tag, rawAttributes, content] = match;
        const attributes = parseAttributes(rawAttributes);
        if (content.trim()) {
            const directive = tag.toLowerCase() === 'script' ? 'script-src' : 'style-src';
            hashes[directive].add(hashSource(content));
        }
        if (tag.toLowerCase() === 'script' && attributes.has('src')) {
            checkResource(attributes.get('src'), 'script-src', directives, file);
        }
    }

    const tags = /<([a-z][\w:-]*)\b([^>]*)>/gi;
    for (const match of html.matchAll(tags)) {
        const tag = match[1].toLowerCase();
        const attributes = parseAttributes(match[2]);
        for (const name of attributes.keys()) {
            if (name === 'style') fail(`${file}: inline style attributes are not allowed`);
            if (/^on/i.test(name)) fail(`${file}: inline event handler ${name} is not allowed`);
        }

        if (tag === 'img') {
            checkResource(attributes.get('src'), 'img-src', directives, file);
        }
        if (tag === 'source') {
            checkResource(attributes.get('src'), 'default-src', directives, file);
        }
        if (tag === 'link') {
            const rel = (attributes.get('rel') ?? '').toLowerCase().split(/\s+/);
            const as = (attributes.get('as') ?? '').toLowerCase();
            const directive = rel.includes('stylesheet') ? 'style-src'
                : rel.includes('modulepreload') || (rel.includes('preload') && as === 'script') ? 'script-src'
                    : rel.includes('preload') && as === 'style' ? 'style-src'
                        : rel.includes('preload') && as === 'font' ? 'font-src'
                            : rel.includes('icon') ? 'img-src' : undefined;
            if (directive) checkResource(attributes.get('href'), directive, directives, file);
        }
    }
}

function checkCss(css, file, directives) {
    const urls = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
    for (const match of css.matchAll(urls)) {
        const resource = (match[1] ?? match[2] ?? match[3] ?? '').trim();
        const directive = /\.(?:woff2?|ttf|otf|eot)(?:[?#]|$)/i.test(resource) ? 'font-src' : 'img-src';
        checkResource(resource, directive, directives, file);
    }
    const imports = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^\s;)]+))/gi;
    for (const match of css.matchAll(imports)) {
        checkResource(match[1] ?? match[2] ?? match[3], 'style-src', directives, file);
    }
}

async function main() {
    const arguments_ = process.argv.slice(2);
    const refreshHashes = arguments_.length === 1 && arguments_[0] === '--refresh-hashes';
    if (arguments_.length > 0 && !refreshHashes) {
        throw new Error('Usage: node scripts/validate-security-policy.mjs [--refresh-hashes]');
    }

    let policy;
    try {
        policy = JSON.parse(await readFile(policyPath, 'utf8'));
    } catch (error) {
        throw new Error(`Unable to read security policy: ${error.message}`);
    }

    const headers = policy.headers;
    const directives = headers?.['Content-Security-Policy'];
    if (!directives || typeof directives !== 'object' || Array.isArray(directives)) {
        throw new Error('security-policy.json must define Content-Security-Policy directives');
    }

    const requiredSources = {
        'default-src': ["'self'"],
        'base-uri': ["'self'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'"],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
    };
    for (const [directive, required] of Object.entries(requiredSources)) {
        const sources = directives[directive];
        if (!Array.isArray(sources)) {
            fail(`CSP must define ${directive} as a source list`);
            continue;
        }
        for (const source of required) {
            if (!sources.includes(source)) fail(`${directive} must include ${source}`);
        }
    }

    for (const [directive, sources] of Object.entries(directives)) {
        if (!Array.isArray(sources)) {
            fail(`${directive} must be a source list`);
            continue;
        }
        for (const source of sources) {
            if (source.includes('*')) fail(`${directive} must not contain wildcard source ${source}`);
            if (source.toLowerCase() === "'unsafe-eval'") fail(`${directive} must not allow unsafe-eval`);
        }
    }
    for (const directive of ['script-src', 'style-src']) {
        if (directives[directive]?.some((source) => source.toLowerCase() === "'unsafe-inline'")) {
            fail(`${directive} must use hashes instead of unsafe-inline`);
        }
    }

    for (const [header, expected] of Object.entries({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
        'Strict-Transport-Security': 'max-age=31536000',
    })) {
        if (headers[header] !== expected) fail(`${header} must be ${expected}`);
    }

    if (!(await access(buildRoot).then(() => true).catch(() => false))) {
        throw new Error('dist/ is missing; run npm run build first');
    }
    const files = await listFiles(buildRoot);
    const htmlFiles = files.filter((file) => extname(file).toLowerCase() === '.html');
    if (htmlFiles.length === 0) fail('dist/ contains no generated HTML files');

    const hashes = { 'script-src': new Set(), 'style-src': new Set() };
    for (const file of htmlFiles) {
        const html = await readFile(file, 'utf8');
        checkHtml(html, relative(buildRoot, file), directives, hashes);
    }
    for (const file of files.filter((path) => extname(path).toLowerCase() === '.css')) {
        checkCss(await readFile(file, 'utf8'), relative(buildRoot, file), directives);
    }

    if (refreshHashes) {
        if (errors.length > 0) {
            console.error('Security policy hash refresh refused:');
            for (const error of errors) console.error(`- ${error}`);
            process.exitCode = 1;
            return;
        }

        for (const directive of ['script-src', 'style-src']) {
            const nonHashSources = directives[directive].filter((source) => !source.startsWith("'sha256-"));
            directives[directive] = [...nonHashSources, ...[...hashes[directive]].sort()];
        }

        await writeFile(policyPath, `${JSON.stringify(policy, null, 4)}\n`);
        console.log(`Refreshed CSP hashes from ${htmlFiles.length} generated HTML files.`);
        return;
    }

    for (const directive of ['script-src', 'style-src']) {
        const configuredHashes = new Set(
            (directives[directive] ?? []).filter((source) => source.startsWith("'sha256-")),
        );
        for (const source of configuredHashes) {
            if (!/^'sha256-[A-Za-z0-9+/]{43}='$/.test(source)) {
                fail(`${directive} contains an invalid SHA-256 source: ${source}`);
            }
        }
        for (const hash of hashes[directive]) {
            if (!configuredHashes.has(hash)) fail(`${directive} is missing generated inline hash ${hash}`);
        }
        for (const hash of configuredHashes) {
            if (!hashes[directive].has(hash)) fail(`${directive} contains stale inline hash ${hash}`);
        }
    }

    if (errors.length) {
        console.error('Security policy validation failed:');
        for (const error of errors) console.error(`- ${error}`);
        process.exitCode = 1;
        return;
    }

    console.log(`Security policy validated against ${htmlFiles.length} generated HTML files.`);
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});