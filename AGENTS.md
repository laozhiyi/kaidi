# Repository Guidelines

## Project Structure

云速取 is a native WeChat Mini Program backed by WeChat Cloud Development. Client pages and feature logic live under `miniprogram/projects/crun/`, with shared components, helpers, templates, and images under `miniprogram/`. Register pages and subpackages in `miniprogram/app.json`.

`cloudfunctions/mcloud/` hosts the API and scheduled jobs. Within `project/crun/`, `public/route.js` maps API routes to controllers. Business logic lives in `service/` and data models in `model/`. `scripts/tests/` holds regression tests, `scripts/test-support/` holds shared fixtures, and `deployment/` contains database rules, indexes, and rollout instructions.

## Build and Development

Import the repository root into WeChat Developer Tools. Confirm the AppID, base library, and development cloud environment, then use **Compile** for simulator testing or **Preview** for device testing.

- `npm ci --prefix cloudfunctions/mcloud --ignore-scripts --no-audit --no-fund` installs locked cloud-function dependencies.
- `npm test --prefix cloudfunctions/mcloud` runs the full Node.js test suite. Use `npm.cmd` in PowerShell if script execution policy blocks `npm`.
- `node scripts/check-architecture-source.cjs` validates source wiring after dependencies are installed.
- `node scripts/check-miniprogram-pages.cjs --wcc "<path to wcc.exe>" --wcsc "<path to wcsc.exe>"` checks templates and styles using the WeChat compilers.

## Coding Style and Naming

Use CommonJS for JavaScript modules and keep page files together with matching `.js`, `.json`, `.wxml`, and `.wxss` basenames. Follow surrounding indentation. WeChat Developer Tools is configured for tabs with a width of four. Use existing names such as `customer_service`, `order_sync_biz.js`, and `tenant_service.js` as patterns.

## Testing

Name regression files `*.test.js` and use `node:test` with `node:assert/strict`. Run an individual file with `node --test scripts/tests/tenant-services.test.js`. Reuse existing fixtures for cloud calls and verify affected WeChat APIs and user flows on a device when applicable.

## Commits and Pull Requests

Use short, descriptive commit subjects. In a PR, explain the affected flow, link the relevant issue if available, and list the checks run. Include screenshots for visible changes and call out required cloud-function, database rule, or index updates. Keep credentials and `project.private.config.json` local. Follow `deployment/MULTI_TENANT_ROLLOUT.md` for deployment and migration changes.
