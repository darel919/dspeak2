import type { Config } from 'tailwindcss';
import daisyui from 'daisyui';

export default {
  content: ['./app/**/*.{vue,js,ts,html}'],
  theme: {
      extend: {
        colors: {
          hero: 'var(--color-hero)',
          'bg-dark': 'var(--color-bg-dark)',
          'bg-light': 'var(--color-bg-light)',
          'accent-1': 'var(--color-accent1)',
          'accent-2': 'var(--color-accent2)',
          'accent-3': 'var(--color-accent3)',
          'accent-4': 'var(--color-accent4)',
          'accent-5': 'var(--color-accent5)',
          navbar: 'var(--color-navbar)'
        },
        fontFamily: {
          hero: ['Caprasimo', 'sans-serif'],
        },
      },
  },
  plugins: [
    daisyui
  ],
  daisyui: {
    themes: ["light", "dark"],
  },
} as Config;
