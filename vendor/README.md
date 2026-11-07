# Vendored security fix

`glib/` contains the published `glib 0.18.5` crate from crates.io, with the
two-line `VariantStrIter::impl_get` fix from
[gtk-rs-core PR #1343](https://github.com/gtk-rs/gtk-rs-core/pull/1343)
(merged as `05dff0ee696f9bcd8617cd48c4b812d046d440cb`).

The original archive is
<https://crates.io/api/v1/crates/glib/0.18.5/download> and its SHA-256 is
`233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`.
Every upstream file is preserved; only the two lines in `src/variant_iter.rs`
are changed. The original MIT license is in `glib/LICENSE`.

The fix makes the C out-argument a mutable pointer and passes `&mut p`, avoiding
the undefined behavior described in
[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html).
The crate retains its upstream version; version-based advisory tools may still
report it. Do not interpret this backport as fixing other GTK3 issues or the
maintenance advisories in transitive dependencies.

Tauri 2.12.5 still depends on GTK 0.18 and cannot use a newer glib independently.
The app's `[patch.crates-io]` selects this local source for that dependency.
Remove the override and this directory when the stable Tauri/GTK dependency
chain supports a fixed upstream version, then refresh the lockfile and notices.

Linux CI runs the upstream iterator tests with optimizations enabled:

```sh
cargo test --manifest-path vendor/glib/Cargo.toml --release --lib variant_iter::tests
```

Build output and the standalone test lockfile are ignored. App builds use the
committed `src-tauri/Cargo.lock`.
