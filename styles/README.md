# `styles/` — Global Styles

Global stylesheets and design tokens applied across the application. Component-level styling
is handled with Tailwind utility classes and styled-jsx; this folder holds the global layer
those build on.

## Responsibilities

- Define global CSS custom properties (design tokens: the carbon-black surface palette and
  the gold `#d4af37` accent) consumed throughout the UI.
- Provide base element styling, scrollbar theming, and animation keyframes referenced by
  components (e.g. dialog/menu transitions).
- Establish dark-theme defaults that the rest of the app assumes.

## Developer notes & best practices

- Prefer CSS variables for colours so theming stays centralised; avoid hard-coding hex
  values in components where a token exists.
- Keep global rules minimal — module-specific styling belongs with the component via
  Tailwind/styled-jsx.
- Any `Content-Security-Policy` `style-src` decisions (inline styles) interact with this
  layer; see `next.config.js`.

## Future extension points

- A light theme could be introduced by overriding the token variables without touching
  component markup.
