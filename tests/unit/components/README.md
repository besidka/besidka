# ThemeSwitcher Component Tests

This document explains the testing strategy for the ThemeSwitcher component.

## Testing Approach

The ThemeSwitcher component is tested using two complementary approaches:

### 1. Unit Tests (Logic-Based)
**Location**: `tests/unit/components/ThemeSwitcher.spec.ts`

Rather than mounting the full Vue component (which has complex DOM manipulation), we test the **business logic** in isolation:

- ✅ **Theme Cycling Logic** (4 tests)
  - Light → Dark → System → Light cycle
  - Complete cycle verification

- ✅ **Label Text Logic** (4 tests)
  - Correct label for each theme state
  - Fallback for undefined themes

- ✅ **Icon Selection Logic** (3 tests)
  - Sun icon for light theme
  - Moon icon for dark theme
  - Sun-moon icon for system theme

- ✅ **Theme Color Meta Logic** (3 tests)
  - Correct color for light theme (#fde4f1)
  - Special lightForDark color (#834f68) when light theme in dark OS mode
  - Correct color for dark theme (#4b283c)

- ✅ **Favicon Logic** (2 tests)
  - Light favicon (/favicon.svg)
  - Dark favicon (/favicon-dark.svg)

- ✅ **OS Color Scheme Logic** (3 tests)
  - Update theme when in system mode
  - Don't update when in light/dark mode
  - Respect OS preference

- ✅ **iOS Reload Logic** (2 tests)
  - Reload on iOS devices
  - Don't reload on other devices

- ✅ **Edge Cases** (3 tests)
  - Valid theme values
  - Invalid theme values
  - Theme cycle order maintained

**Total: 24 unit tests**

### 2. E2E Tests (User Interaction)
**Location**: `tests/e2e/settings/theme.spec.ts`

Tests the complete user experience in a real browser:

- ✅ **Visual Display** (2 tests)
  - Theme switcher button visible
  - Correct tooltip text displayed

- ✅ **User Interactions** (3 tests)
  - Clicking cycles through all themes
  - Theme persists on page reload
  - Theme persists in localStorage

- ✅ **Meta Tag Updates** (2 tests)
  - theme-color meta tag exists
  - theme-color changes with theme

- ✅ **Icon Display** (3 tests)
  - Sun icon for light theme
  - Moon icon for dark theme
  - Sun-moon icon for system theme

- ✅ **Favicon Updates** (1 test)
  - Favicon changes when theme changes

- ✅ **Accessibility** (1 test)
  - Keyboard navigation works

- ✅ **Performance** (1 test)
  - No content flash on initial load

**Total: 13 E2E tests** (× 5 browsers = 65 test runs)

## Component Test IDs

The ThemeSwitcher component uses explicit `data-testid` attributes for reliable testing:

```vue
<!-- ThemeSwitcher.vue -->
<UiButton data-testid="theme-switcher">
  <Icon data-testid="theme-icon-light" name="lucide:sun" />
  <Icon data-testid="theme-icon-dark" name="lucide:moon" />
  <Icon data-testid="theme-icon-system" name="lucide:sun-moon" />
</UiButton>
<div data-testid="theme-switcher-loading">...</div>
```

**Why data-testid?**
- ✅ Explicit and stable - won't break with refactoring
- ✅ Self-documenting - clear what's being tested
- ✅ No ambiguity - unlike generic `button` selectors
- ✅ Playwright best practice - `page.getByTestId('name')`

**Never use:**
- ❌ Generic selectors: `page.locator('button')`
- ❌ CSS classes: `page.locator('.btn-theme')`
- ❌ Text content: `page.locator('text=Switch')`

## Why This Approach?

### Unit Tests - Logic Focus
- **Fast**: Run in milliseconds
- **Reliable**: No DOM dependencies
- **Focused**: Test pure JavaScript logic
- **Easy to debug**: Clear inputs and outputs

### E2E Tests - User Focus
- **Realistic**: Tests actual user experience
- **Cross-browser**: Runs in Chromium, Firefox, WebKit
- **Integration**: Tests component in real app context
- **Visual**: Validates UI appearance
- **Stable selectors**: Uses data-testid for reliability

## Running the Tests

```bash
# Run unit tests
pnpm run test:unit

# Run E2E tests
pnpm run test:e2e

# Run E2E tests with UI
pnpm run test:e2e:ui

# Run specific E2E test
pnpm exec playwright test theme.spec.ts
```

## Test Coverage

### What's Tested ✅
- Theme cycling (light → dark → system → light)
- Icon display for each theme
- Label text for each theme
- Theme-color meta tag updates
- Favicon updates
- localStorage persistence
- Page reload persistence
- OS preference detection
- iOS-specific behavior
- Keyboard accessibility
- Edge cases and validation

### What's NOT Tested ⚠️
- Actual service worker behavior
- PWA manifest theme-color
- Animation/transition timings
- Mobile vs desktop differences (except iOS reload)

## Key Implementation Details

### Theme Cycle Order
```typescript
light → dark → system → light
```

### Theme Colors
- **Light**: `#fde4f1`
- **Dark**: `#4b283c`
- **Light (for dark OS)**: `#834f68`

### Favicons
- **Light**: `/favicon.svg`
- **Dark**: `/favicon-dark.svg`

### Icons
- **Light**: `lucide:sun`
- **Dark**: `lucide:moon`
- **System**: `lucide:sun-moon`

## Debugging Tests

### Unit Test Failures
If unit tests fail, check:
1. Logic in the actual component matches test expectations
2. Theme values are one of: 'light', 'dark', 'system'
3. Color values match app.config.ts

### E2E Test Failures
If E2E tests fail, check:
1. Dev server is running (`pnpm run dev`)
2. Theme switcher button is visible
3. localStorage is enabled in test browser
4. matchMedia is supported in test environment

## Future Enhancements

Potential test additions:
- [ ] Test theme preference from system at startup
- [ ] Test PWA standalone mode theme behavior
- [ ] Test theme flash prevention on slow connections
- [ ] Test theme change during page navigation
- [ ] Test theme in iframe contexts
- [ ] Visual regression testing for theme transitions
