# Repository Guidelines

## Project Structure

云速取 is a native WeChat Mini Program backed by WeChat Cloud Development. Feature pages, components, and client business logic live under `miniprogram/projects/crun/`. Shared components, helpers, templates, and assets live in `miniprogram/cmpts/`, `miniprogram/helper/`, `miniprogram/tpls/`, and `miniprogram/images/`. Register new pages in `miniprogram/app.json`.

`cloudfunctions/mcloud/` runs the API and scheduled jobs. Under `cloudfunctions/mcloud/project/crun/`, `public/route.js` maps routes to controllers, `service/` holds business rules, and `model/` defines persistence. Regression tests and their fixtures live in `scripts/tests/` and `scripts/test-support/`. See `deployment/` for database rules, indexes, and rollout steps.

## Build and Development

Import the repository root into WeChat Developer Tools. Confirm the AppID and target cloud environment, then use **Compile** for simulator checks and **Preview** for device checks.

- `npm ci --prefix cloudfunctions/mcloud --ignore-scripts --no-audit --no-fund` installs locked cloud dependencies.
- `npm test --prefix cloudfunctions/mcloud` runs the regression suite. Use `npm.cmd` if PowerShell blocks the npm script shim.
- `node scripts/check-architecture-source.cjs` checks source wiring after dependencies are installed.
- `node scripts/check-miniprogram-pages.cjs` checks page registration and imports. Pass `--wcc "<path to wcc.exe>" --wcsc "<path to wcsc.exe>"` to compile templates and styles.

## Coding Style

Use CommonJS and match surrounding indentation. WeChat Developer Tools uses four-column tabs. Keep each page’s `.js`, `.json`, `.wxml`, and `.wxss` files on the same basename. Follow existing names such as `mail_service.js` and `order_sync_biz.js`. Preserve school and campus scoping when changing database queries.

## Testing

Write focused regressions in `*.test.js` using `node:test` and `node:assert/strict`. Run a single file with `node --test scripts/tests/tenant-services.test.js`. Reuse cloud fixtures and test changes to native authorization on a device.

## Commits and Pull Requests

Use concise Chinese commit subjects that describe the change, as in `完善微信登录、手机号验证与雁山校区内测`. In PRs, explain the affected flow, list checks run, link relevant issues, and include screenshots for visible changes. Call out cloud deployment or database changes and follow `deployment/MULTI_TENANT_ROLLOUT.md`. Keep credentials and `project.private.config.json` local.
