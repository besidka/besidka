# Testing Guidelines for Besidka

## Critical Rule: ALWAYS Use data-testid

### ❌ WRONG - Generic Selectors

```vue
<!-- Component -->
<button @click="handleClick">Submit</button>
```

```typescript
// Test - FRAGILE! Will break if you add another button
const button = page.locator('button')
await button.click()
```

**Problems:**
- Breaks when adding more buttons
- Unclear which button is being tested
- Fails when button changes to `<a>` tag
- Not explicit about intent

### ✅ RIGHT - data-testid Selectors

```vue
<!-- Component -->
<button data-testid="submit-form" @click="handleClick">Submit</button>
```

```typescript
// Test - STABLE! Clear and explicit
const button = page.getByTestId('submit-form')
await button.click()
```

**Benefits:**
- ✅ Won't break with refactoring
- ✅ Self-documenting test intent
- ✅ No ambiguity about which element
- ✅ Playwright best practice

## Implementation Checklist

When adding tests to a component:

### 1. Add data-testid First
```vue
<template>
  <div data-testid="my-component">
    <button data-testid="my-component-action">Click Me</button>
    <span data-testid="my-component-status">{{ status }}</span>
  </div>
</template>
```

### 2. Name Consistently
Use the pattern: `{component}-{element}-{purpose}`

**Examples:**
- `theme-switcher` - Main button
- `theme-icon-light` - Light theme icon
- `theme-icon-dark` - Dark theme icon
- `theme-switcher-loading` - Loading overlay
- `chat-input` - Message input field
- `chat-message` - Individual message
- `chat-send-button` - Send button

### 3. Write Tests
```typescript
test('should interact with component', async ({ page }) => {
  const component = page.getByTestId('my-component')
  const actionButton = page.getByTestId('my-component-action')
  const status = page.getByTestId('my-component-status')

  await expect(component).toBeVisible()
  await actionButton.click()
  await expect(status).toHaveText('Clicked')
})
```

## Selector Priority Guide

### 1. ✅ data-testid (ALWAYS PREFER)
```typescript
page.getByTestId('submit-button')
```
**Use for:** All interactive elements in tests

### 2. ⚠️ ARIA Attributes (Accessibility)
```typescript
page.getByRole('button', { name: 'Submit' })
page.getByLabel('Email address')
```
**Use for:** Accessibility tests, when data-testid not available

### 3. ❌ Text Content (AVOID)
```typescript
page.getByText('Submit') // May change with i18n
```
**Problems:** Changes with translations, copy updates

### 4. ❌ CSS Classes (NEVER USE)
```typescript
page.locator('.btn-primary') // Changes with styling
```
**Problems:** Tied to implementation, not semantics

### 5. ❌ Generic Elements (NEVER USE)
```typescript
page.locator('button') // Which button?
page.locator('div') // Which div?
```
**Problems:** Ambiguous, fragile, breaks easily

## Real-World Examples

### ThemeSwitcher Component

**Component:**
```vue
<template>
  <UiButton data-testid="theme-switcher" @click="changeTheme">
    <Icon
      v-if="theme === 'light'"
      data-testid="theme-icon-light"
      name="lucide:sun"
    />
    <Icon
      v-else-if="theme === 'dark'"
      data-testid="theme-icon-dark"
      name="lucide:moon"
    />
    <Icon
      v-else
      data-testid="theme-icon-system"
      name="lucide:sun-moon"
    />
  </UiButton>
  <div v-if="loading" data-testid="theme-switcher-loading">
    Loading...
  </div>
</template>
```

**Test:**
```typescript
test('should cycle through themes', async ({ page }) => {
  const switcher = page.getByTestId('theme-switcher')

  // Verify light theme
  await expect(page.getByTestId('theme-icon-light')).toBeVisible()

  // Click to switch to dark
  await switcher.click()
  await expect(page.getByTestId('theme-icon-dark')).toBeVisible()

  // Click to switch to system
  await switcher.click()
  await expect(page.getByTestId('theme-icon-system')).toBeVisible()
})
```

### Form Component

**Component:**
```vue
<template>
  <form data-testid="login-form" @submit="handleSubmit">
    <input
      data-testid="login-email"
      type="email"
      v-model="email"
    />
    <input
      data-testid="login-password"
      type="password"
      v-model="password"
    />
    <button data-testid="login-submit" type="submit">
      Sign In
    </button>
    <div v-if="error" data-testid="login-error">
      {{ error }}
    </div>
  </form>
</template>
```

**Test:**
```typescript
test('should show error for invalid credentials', async ({ page }) => {
  await page.goto('/login')

  const form = page.getByTestId('login-form')
  const emailInput = page.getByTestId('login-email')
  const passwordInput = page.getByTestId('login-password')
  const submitButton = page.getByTestId('login-submit')

  await emailInput.fill('invalid@example.com')
  await passwordInput.fill('wrongpassword')
  await submitButton.click()

  const error = page.getByTestId('login-error')
  await expect(error).toBeVisible()
  await expect(error).toContainText('Invalid credentials')
})
```

## Common Mistakes to Avoid

### ❌ Mistake 1: Using Generic Selectors
```typescript
// BAD
await page.locator('button').click()

// GOOD
await page.getByTestId('submit-button').click()
```

### ❌ Mistake 2: Using nth-child or Indices
```typescript
// BAD - breaks when order changes
await page.locator('button').nth(2).click()

// GOOD
await page.getByTestId('delete-button').click()
```

### ❌ Mistake 3: Using CSS Classes
```typescript
// BAD - breaks when styling changes
await page.locator('.btn-primary').click()

// GOOD
await page.getByTestId('primary-action').click()
```

### ❌ Mistake 4: Using Text Content
```typescript
// BAD - breaks with i18n
await page.locator('text=Submit').click()

// GOOD
await page.getByTestId('submit-button').click()
```

### ❌ Mistake 5: Forgetting to Add data-testid
```typescript
// BAD - adding tests without updating component
test('should click button', async ({ page }) => {
  await page.locator('button').click() // No data-testid in component
})

// GOOD - update component first, then test
// 1. Add to component: <button data-testid="my-button">
// 2. Then write test:
test('should click button', async ({ page }) => {
  await page.getByTestId('my-button').click()
})
```

## Enforcement

### Pre-commit Hook
Consider adding a lint rule to enforce data-testid usage:

```javascript
// .eslintrc.js
rules: {
  'testing-library/prefer-user-event': 'error',
  'playwright/no-generic-selectors': 'error', // Custom rule
}
```

### Code Review Checklist
- [ ] All interactive elements have `data-testid`
- [ ] Tests use `page.getByTestId()` not `page.locator()`
- [ ] Test IDs follow naming convention
- [ ] No generic selectors (button, div, etc.)
- [ ] No CSS class selectors

## Migration Guide

If you have existing tests with generic selectors:

### Step 1: Add data-testid to Component
```vue
<!-- Before -->
<button @click="save">Save</button>

<!-- After -->
<button data-testid="save-button" @click="save">Save</button>
```

### Step 2: Update Test
```typescript
// Before
const button = page.locator('button')

// After
const button = page.getByTestId('save-button')
```

### Step 3: Verify
```bash
pnpm run test:e2e
```

## Resources

- [Playwright Test IDs](https://playwright.dev/docs/locators#locate-by-test-id)
- [Testing Library Best Practices](https://testing-library.com/docs/queries/about/#priority)
- [Why data-testid](https://kentcdodds.com/blog/making-your-ui-tests-resilient-to-change)

## Summary

**Golden Rule:** If you're writing a test for a UI element, that element MUST have a `data-testid`.

No exceptions. No generic selectors. Always explicit and stable.
