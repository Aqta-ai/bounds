import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          black:  '#2A2D34',
          blue:   '#009DDC',
          orange: '#F26430',
          grape:  '#6761A8',
          green:  '#009E60',
        },
        // PII type colours — also defined in src/utils/colors.ts
        pii: {
          name: '#ef4444',       // red-500
          address: '#f97316',    // orange-500
          financial: '#a855f7',  // purple-500
          identifier: '#3b82f6', // blue-500
          contact: '#22c55e',    // green-500
          date: '#eab308',       // yellow-500
          misc: '#6b7280',       // gray-500
        },
      },
    },
  },
  plugins: [],
} satisfies Config
