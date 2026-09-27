# Security Headers Policy

`security-policy.json` records the intended response headers for this site. It
is provider-neutral and is not applied by Astro or included as a browser meta
tag. The project currently generates a static site and has no configured
hosting layer, so these headers are not active until the eventual host or CDN
is configured to serve them.

When AWS hosting is selected, translate this policy into the chosen delivery
layer's infrastructure configuration (for example, a CloudFront response
headers policy managed as infrastructure-as-code). Keep that configuration
aligned with this policy. Enable HSTS only after HTTPS is enforced for the
site; add `includeSubDomains` only if every affected subdomain is HTTPS-only.

## Content Security Policy

The current site loads scripts, styles, images, and fonts from its own origin.
It has inline Astro-generated scripts and styles, so their SHA-256 hashes are
explicitly allowlisted in `security-policy.json`. Do not replace these hashes
with `unsafe-inline`, and do not add wildcard sources or `unsafe-eval`.

After changing pages, scripts, styles, or Astro's generated output, run:

```sh
npm run build
npm run security:validate
```

If validation reports new inline hashes, review the corresponding built blocks
in `dist/` and update the `script-src` or `style-src` hash list only for code
that is intended to run or apply. Stale hashes are also rejected. The
validator checks the policy and generated build, but does not prove that a
hosting provider is sending these headers; add a deployed-response check when
the host is introduced.