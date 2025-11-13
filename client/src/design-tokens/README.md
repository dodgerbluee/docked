# Design Tokens

This directory contains the design system tokens for the application. Design tokens are the visual design atoms of the design system — specifically, they are named entities that store visual design attributes.

## Structure

### Colors (`colors.js`)
Centralized color definitions that map to CSS variables. All colors should be referenced through this file or directly via CSS variables.

**Available Colors:**
- **Primary Brand Colors:**
  - `DODGER_BLUE`: Primary brand blue (`var(--dodger-blue)`)
  - `DODGER_BLUE_LIGHT`: Light variant of brand blue
  - `DODGER_RED`: Primary brand red
  - `DODGER_RED_LIGHT`: Light variant of brand red

- **Feature Colors:**
  - `TRACKED_APPS_PURPLE`: Purple used for tracked apps features (`var(--tracked-apps-purple)`)
  - `SUCCESS_GREEN`: Green used for success states (`var(--success-green)`)

- **Semantic Colors:**
  - `TEXT_PRIMARY`, `TEXT_SECONDARY`, `TEXT_TERTIARY`: Text color variants
  - `BG_PRIMARY`, `BG_SECONDARY`, `BG_TERTIARY`: Background color variants
  - `BORDER_COLOR`: Default border color

### Numbers (`../constants/numbers.js`)
Numeric constants used throughout the application:
- Time conversions (milliseconds, seconds, minutes, hours)
- Default values (intervals, delays, polling)
- Minimum/maximum values

## CSS Variables

All design tokens are exposed as CSS variables in `App.css` under `:root` and `body.dark-mode`. These variables support both light and dark themes.

### Usage

**In JavaScript/TypeScript:**
```javascript
import { COLORS } from '../design-tokens/colors';
// Use COLORS.DODGER_BLUE, etc.
```

**In CSS:**
```css
.my-component {
  color: var(--dodger-blue);
  background: var(--bg-primary);
}
```

## Best Practices

1. **Always use CSS variables or design tokens** - Never hardcode color values
2. **Use semantic names** - Prefer `TEXT_PRIMARY` over `#000000`
3. **Support dark mode** - All colors should have dark mode variants
4. **Document new tokens** - When adding new colors, update this README

## Adding New Tokens

1. Add the CSS variable to `App.css` in both `:root` and `body.dark-mode`
2. Add the token to the appropriate file in `design-tokens/`
3. Update this README with the new token
4. Use the token consistently across the application

