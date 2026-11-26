# Repository Guidelines

## Project Structure

云速取 is a native WeChat Mini Program backed by WeChat Cloud Development. Feature pages, components, and client business logic live under `miniprogram/projects/crun/`. Shared components, helpers, templates, and assets live in `miniprogram/cmpts/`, `miniprogram/helper/`, `miniprogram/tpls/`, and `miniprogram/images/`. Register new pages in `miniprogram/app.json`.

`cloudfunctions/mcloud/` contains the main API, the scheduled jobs (`orders-minute`, `notifications-minute` in `config.json`), and the HTTP payment callbacks for WeChat Pay and AdaPay. `cloudfunctions/payNotify/` is a disabled placeholder; never route payments to it. Under `cloudfunctions/mcloud/project/crun/`, `public/route.js` maps routes to controllers, `service/` holds business rules, and `model/` defines persistence. Regression tests and their fixtures live in `scripts/tests/` and `scripts/test-support/`. `deployment/` holds only database rules and index manifests. All maintenance documentation lives in `docs/` and is indexed in `README.md`.

## Build and Development

Import the repository root into WeChat Developer Tools. Confirm the AppID and target cloud environment, then use **Compile** for simulator checks and **Preview** for device checks.

- `npm install --prefix cloudfunctions/mcloud --no-package-lock --ignore-scripts --no-audit --no-fund` installs the cloud dependencies declared in `package.json`.
- `npm test --prefix cloudfunctions/mcloud` runs the regression suite. Use `npm.cmd` if PowerShell blocks the npm script shim.
- `node scripts/check-architecture-source.cjs` checks source wiring after dependencies are installed.
- `node scripts/check-miniprogram-pages.cjs` checks page registration, component references, and imports. Pass `--wcc "<path to wcc.exe>" --wcsc "<path to wcsc.exe>"` to compile templates and styles.

## Coding Style

Use CommonJS and match surrounding indentation. WeChat Developer Tools uses four-column tabs. Keep each page’s `.js`, `.json`, `.wxml`, and `.wxss` files on the same basename. Follow existing names such as `mail_service.js` and `order_sync_biz.js`. Preserve school and campus scoping when changing database queries.

## Testing

Write focused regressions in `*.test.js` using `node:test` and `node:assert/strict`. Run a single file with `node --test scripts/tests/tenant-services.test.js`. Reuse the fixtures in `scripts/test-support/` for cloud services. Cover the changed behavior and its failure paths. Check changes to native authorization, payment, or other WeChat platform APIs on a device in the target cloud environment.

## Repository Hygiene and Documentation

Follow `CONTRIBUTING.md`; `scripts/tests/repo-hygiene.test.js` enforces it.

- Commit only source, tests, deployment config, and maintained docs. Put logs, screenshots, previews, snapshots, and scratch scripts in `.tmp/`, which is ignored. Never create files at the repository root.
- Do not write reports, summaries, diagnoses, or plans as Markdown files (no `*_REPORT.md`, `*_SUMMARY.md`, `FIX_*.md`). Put that content in the commit message or your reply to the user.
- When behavior changes, edit the matching `docs/*.md` section in place so it describes the current state. Do not append dated changelog paragraphs or phrases such as 本次、本轮、尚未上传.
- A new doc must be a module-level reference in `docs/` and be listed in the README table. Prefer extending an existing doc.

## Commits

Use concise Chinese commit subjects that describe the change, as in `完善微信登录、手机号验证与雁山校区内测`. For larger changes, use the commit body to explain the affected flow and list checks run. Call out cloud deployment or database changes there and follow `docs/DEPLOYMENT.md`. Work directly on `main`: do not create branches or pull requests. Run `git pull --rebase origin main` and the regression suite before every push, and never force-push `main`. Keep credentials and `project.private.config.json` local.
