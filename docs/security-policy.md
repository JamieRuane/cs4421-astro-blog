# Security Headers Policy

`security-policy.json` is the source for the security response headers applied
by the CDK-managed CloudFront response headers policy. Astro does not apply
these headers itself. The policy is attached to both the static site behavior
and the `/api/*` behavior.

Keep the generated CloudFront policy aligned with this file. Both CloudFront
behaviors redirect HTTP viewers to HTTPS before applying HSTS. Do not add
`includeSubDomains` unless every affected subdomain is HTTPS-only.

## Content Security Policy

The browser loads scripts, styles, images, fonts, and API responses from its
own origin. The weather Lambda calls Open-Meteo server-side. Astro-generated
inline scripts and styles are explicitly allowlisted by SHA-256 hash. Do not
replace hashes with `unsafe-inline`, and do not add wildcard sources or
`unsafe-eval`.

After changing pages, scripts, styles, or Astro's generated output, regenerate
the inline hashes from the current production build and validate them:

```sh
npm run build
npm run security:refresh-hashes
npm run security:validate
```

The site build contains static HTML, including blog routes generated from the
content collection. The validator derives hashes from built inline `<script>`
and `<style>` blocks and checks built CSS and HTML resources. It refuses to
update the policy if the build has inline style attributes, inline event
handlers, disallowed resources, or another policy violation. Normal
`security:validate` is read-only and rejects missing or stale hashes.

The validator checks the policy against generated site assets. The deployment
workflow also checks the headers returned by CloudFront; headers existing only
in this policy file are not sufficient.
