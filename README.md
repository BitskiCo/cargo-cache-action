# cargo-cache-action

Cargo Cache GitHub Action caches Cargo dependencies and build outputs.

## Usage

```yaml
name: Rust

on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v2

      - name: Configure Cache
        uses: BitskiCo/cargo-cache-action@v1

      - name: Run cargo test
        run: cargo test --all-features --all-targets --workspace
```
