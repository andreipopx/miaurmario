/** @type {import('tailwindcss').Config} */
// Stinky pop — every colour/radius comes from CSS variables in app/globals.css.
module.exports = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        panel: 'var(--panel)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        signature: {
          DEFAULT: 'var(--signature)',
          foreground: 'var(--signature-foreground)',
          soft: 'var(--signature-soft)',
        },
        pop: {
          amber: 'var(--pop-amber)',
          pink: 'var(--pop-pink)',
          sky: 'var(--pop-sky)',
          mint: 'var(--pop-mint)',
          foreground: 'var(--pop-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        success: {
          DEFAULT: 'var(--success)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Figtree', 'system-ui', 'sans-serif'],
        wordmark: ['var(--font-wordmark)', 'Figtree', 'system-ui', 'sans-serif'],
      },
      // One layer scale for the whole app. The order (and what belongs where)
      // is documented next to the tokens in app/globals.css and in
      // DESIGN-SYSTEM.md. Raw z-0..z-20 stay for local stacking inside a
      // card; anything `fixed` uses a name from here.
      zIndex: {
        page: 'var(--z-page)',
        header: 'var(--z-header)',
        dock: 'var(--z-dock)',
        float: 'var(--z-float)',
        status: 'var(--z-status)',
        drawer: 'var(--z-drawer)',
        modal: 'var(--z-modal)',
        popover: 'var(--z-popover)',
        lightbox: 'var(--z-lightbox)',
        toast: 'var(--z-toast)',
      },
      // Bottom of the screen: the slots that clear the floating dock.
      inset: {
        'float-1': 'var(--float-slot-1)',
        'float-2': 'var(--float-slot-2)',
      },
      borderRadius: {
        // Cards / panels 24px, garment tiles 18px, quick actions 16px.
        // Buttons, inputs and chips use rounded-full.
        '4xl': '2rem',
        lg: 'var(--radius)',
        tile: 'var(--radius-tile)',
        quick: 'var(--radius-quick)',
        md: '14px',
        sm: '10px',
      },
      transitionTimingFunction: {
        pop: 'cubic-bezier(0.34, 1.3, 0.64, 1)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: 0 },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: 0 },
        },
        'progress-indeterminate': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(250%)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'progress-indeterminate': 'progress-indeterminate 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
