# Contributing

Thanks for contributing to `notion-sync`.

## Local setup

```bash
git clone https://github.com/jozrftamson/notion-sync.git
cd notion-sync
npm test
```

For CLI development with a local config:

```bash
mkdir playground
cd playground
notion-sync init
notion-sync doctor
```

## What helps most

- bug reports with exact commands and output
- docs improvements
- tests for edge cases
- small focused feature additions
- portability fixes across different local environments

## Pull request guidelines

- keep changes focused
- update tests when behavior changes
- update `README.md` when user-facing commands change
- update `CHANGELOG.md` for release-relevant changes
- avoid committing secrets, `.env`, or local exports

## Good first contributions

- add docs examples
- improve error messages
- extend screenshot coverage
- add tests for CLI flags and edge cases
- improve onboarding and troubleshooting notes
