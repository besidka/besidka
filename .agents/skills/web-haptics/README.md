# WebHaptics

Haptic feedback for the mobile web. Supports React, Vue, and Svelte.

## Installation

```sh
npm i web-haptics
```

## Usage

```tsx
import { useWebHaptics } from "web-haptics/react";

function App() {
  const { trigger } = useWebHaptics();

  return <button onClick={() => trigger("success")}>Tap me</button>;
}
```

See the [package README](packages/web-haptics/README.md) for Vue, Svelte, and vanilla examples.

# Contributing

## Install dependencies

```sh
pnpm install:all
```

## Dev/Watch Library and Example

```sh
pnpm dev
```

## Build Library

```sh
pnpm build
```

## Found this useful?

Follow me on [Twitter](https://twitter.com/lochieaxon).

## Other projects

You might also like:

- [Torph](https://torph.lochie.me) - Dependency-free animated text component.
- [easing.dev](https://easing.dev) - Easily create custom easing graphs.

# Acknowledgements

- Special thanks to [Alex](https://x.com/alexvanderzon) for assistance with the site design.
