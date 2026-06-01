/** @type {import('tailwindcss').Config} */
// AhaSlides brand tokens — source of truth: brand guidelines v1.0 (06/02/2025).
// Colours are flat solids only; no gradients per brand rules.
export default {
  content: ['./index.html', './src/**/*.{vue,ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        aha: {
          pink: '#FF4081',          // Radical Pink — primary brand colour
          purple: '#6A1EBB',        // Violet Purple — primary CTA
          space: '#1A1A2E',         // Deep Space Blue — text/dark surface
          carmine: '#E6005C',       // Errors
          'dark-purple': '#5A189A', // Alt dark background
          indigo: '#3E3E5A',        // Muted Indigo Gray — dividers
          sky: '#F0F4FF',           // Soft Sky White — alt background
          coral: '#FF9068',         // Coral Sunset — warning
          teal: '#20E8B5',          // Bright Teal — success
          mint: '#B4E4E0',          // Cool Mint Teal
          lavender: '#D3B4FF',      // Lavender Mist
          rose: '#FAF0F6',          // Rose Quartz White
          blush: '#FDF6FA',         // Blush White
        },
      },
      fontFamily: {
        sans: [
          'Plus Jakarta Sans',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
      },
      fontWeight: {
        regular: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
        extrabold: '800',
      },
      boxShadow: {
        'aha-sm': '0 1px 2px rgba(26, 26, 46, 0.06), 0 1px 3px rgba(26, 26, 46, 0.04)',
        'aha-md': '0 4px 12px rgba(26, 26, 46, 0.08)',
        'aha-lg': '0 10px 30px rgba(26, 26, 46, 0.12)',
        'aha-pink': '0 6px 20px rgba(255, 64, 129, 0.30)',
        'aha-purple': '0 6px 20px rgba(106, 30, 187, 0.30)',
      },
      borderRadius: {
        aha: '12px',
      },
    },
  },
  plugins: [],
  corePlugins: {
    preflight: true,
  },
}
