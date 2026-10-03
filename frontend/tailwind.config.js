/**
 * A colour token that also works with Tailwind's opacity modifier (bg-background/90).
 * The tokens are plain hex variables, which Tailwind can't make translucent on its own,
 * so those classes used to produce no CSS at all (the Stinky chat header was see-through).
 * Plain classes stay exactly `var(--x)`; only `/NN` ones mix with transparent, and a
 * browser without color-mix() simply ignores them, as before.
 */
const tok = (name) => ({ opacityValue }) =>
  opacityValue === undefined || opacityValue === '1' || String(opacityValue).startsWith('var(')
    ? `var(${name})`
    : `color-mix(in srgb, var(${name}) calc(${opacityValue} * 100%), transparent)`;

/** @type {import('tailwindcss').Config} */
// Stinky pop — every colour/radius comes from CSS variables in app/globals.css.
module.exports = {
  darkMode: ['class'],
  // hover: styles only where a real pointer can hover, so a tapped tile or button
  // doesn't stay lifted/highlighted on phones after the finger leaves.
  future: { hoverOnlyWhenSupported: true },
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
        border: tok('--border'),
        input: tok('--input'),
        ring: tok('--ring'),
        background: tok('--background'),
        foreground: tok('--foreground'),
        panel: tok('--panel'),
        primary: {
          DEFAULT: tok('--primary'),
          foreground: tok('--primary-foreground'),
        },
        secondary: {
          DEFAULT: tok('--secondary'),
          foreground: tok('--secondary-foreground'),
        },
        signature: {
          DEFAULT: tok('--signature'),
          foreground: tok('--signature-foreground'),
          soft: tok('--signature-soft'),
        },
        pop: {
          amber: tok('--pop-amber'),
          pink: tok('--pop-pink'),
          sky: tok('--pop-sky'),
          mint: tok('--pop-mint'),
          foreground: tok('--pop-foreground'),
        },
        destructive: {
          DEFAULT: tok('--destructive'),
          foreground: tok('--destructive-foreground'),
        },
        muted: {
          DEFAULT: tok('--muted'),
          foreground: tok('--muted-foreground'),
        },
        accent: {
          DEFAULT: tok('--accent'),
          foreground: tok('--accent-foreground'),
        },
        popover: {
          DEFAULT: tok('--popover'),
          foreground: tok('--popover-foreground'),
        },
        card: {
          DEFAULT: tok('--card'),
          foreground: tok('--card-foreground'),
        },
        success: {
          DEFAULT: tok('--success'),
        },
        warning: {
          DEFAULT: tok('--warning'),
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
