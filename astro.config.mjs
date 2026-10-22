// @ts-check

import mdx from '@astrojs/mdx';
import node from '@astrojs/node';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';

import { localApiPlugin } from './scripts/local-api-plugin.mjs';

// https://astro.build/config
export default defineConfig({
  site: 'https://d2nod46fx08aeg.cloudfront.net/',
  output: 'server',
  adapter: node({
    mode: 'standalone',
  }),
  integrations: [mdx(), sitemap()],
  vite: {
    plugins: [localApiPlugin()],
  },

  markdown: {
      syntaxHighlight: 'prism',
	},

  fonts: [
      {
          provider: fontProviders.local(),
          name: 'Atkinson',
          cssVariable: '--font-atkinson',
          fallbacks: ['sans-serif'],
          options: {
              variants: [
                  {
                      src: ['./src/assets/fonts/atkinson-regular.woff'],
                      weight: 400,
                      style: 'normal',
                      display: 'swap',
                  },
                  {
                      src: ['./src/assets/fonts/atkinson-bold.woff'],
                      weight: 700,
                      style: 'normal',
                      display: 'swap',
                  },
              ],
          },
      },
	],
});