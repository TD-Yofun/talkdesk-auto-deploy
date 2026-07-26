

## [1.0.14](https://github.com/TD-Yofun/github-auto-deploy/compare/v1.0.13...v1.0.14) (2026-07-26)


### Features

* add github home pull request sidebar ([78a7b9e](https://github.com/TD-Yofun/github-auto-deploy/commit/78a7b9e4769122d6aa79567cd0155e5b6a7b5204))

## [1.0.13](https://github.com/TD-Yofun/github-auto-deploy/compare/v1.0.12...v1.0.13) (2026-07-21)


### Bug Fixes

* handle deployment approval recovery ([28a6cf3](https://github.com/TD-Yofun/github-auto-deploy/commit/28a6cf367f7712a6c301b1d42fb151fcf8a98c44))

## [1.0.12](https://github.com/TD-Yofun/github-auto-deploy/compare/v1.0.11...v1.0.12) (2026-07-20)


### Features

* support review deployments approval flow ([b2d69bd](https://github.com/TD-Yofun/github-auto-deploy/commit/b2d69bd2ac5a3497b52fd77e83fcb42d1d8dcc77))

## [1.0.11](https://github.com/TD-Yofun/github-auto-deploy/compare/v1.0.10...v1.0.11) (2026-07-03)


### Bug Fixes

* avoid github api for version checks ([d0586c4](https://github.com/TD-Yofun/github-auto-deploy/commit/d0586c4bc230d8d4d648263e04e1006cad6f8f99))

## [1.0.10](https://github.com/TD-Yofun/github-auto-deploy/compare/v1.0.9...v1.0.10) (2026-06-08)


### Bug Fixes

* update repo references from talkdesk-auto-deploy to github-auto-deploy ([537a6e6](https://github.com/TD-Yofun/github-auto-deploy/commit/537a6e687dc44cfd818b32763c9ae8a3f20369c6))

## [1.0.9](https://github.com/TD-Yofun/talkdesk-auto-deploy/compare/v1.0.8...v1.0.9) (2026-05-16)


### Features

* react to header status mutations for near-instant terminal detection ([7d6c96e](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/7d6c96e15daa0c5dbeebe44e28a68228d2edec4a))

## [1.0.8](https://github.com/TD-Yofun/talkdesk-auto-deploy/compare/v1.0.7...v1.0.8) (2026-05-16)


### Bug Fixes

* narrow run-status detection to authoritative header element ([840cb3f](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/840cb3ff50c8041fd7ec901e0084bc3c4a2f04cf))

## [1.0.7](https://github.com/TD-Yofun/talkdesk-auto-deploy/compare/v1.0.6...v1.0.7) (2026-05-16)


### Bug Fixes

* stabilize log ordering, terminal detection, and scroll behavior ([1f5c61e](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/1f5c61e53a41c4ea8bcd2c2a291133c7d24f6c8f))

## [1.0.6](https://github.com/TD-Yofun/talkdesk-auto-deploy/compare/v1.0.5...v1.0.6) (2026-05-16)


### Bug Fixes

* harden poll scheduler and skip-button observer against silent failure ([7258bfc](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/7258bfcd4971dfd931ce795cb1dd2d9079d0932c))
* **version-check:** shorten cache TTL and invalidate when current > cached ([21b5b4c](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/21b5b4c7cb6a908e3d3d7c198b774598f4b60e10))

## [1.0.5](https://github.com/TD-Yofun/talkdesk-auto-deploy/compare/v1.0.4...v1.0.5) (2026-05-16)


### Bug Fixes

* reset log on new Start and harden run-conclusion detection ([a5a4013](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/a5a40137310e7f09ec2771fb8bdb1274195c43fa))

## [1.0.4](https://github.com/TD-Yofun/talkdesk-auto-deploy/compare/v1.0.3...v1.0.4) (2026-05-16)


### Features

* log persistence, watchdog, auto-report, notifications, pause, overview ([b9a0990](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/b9a099010010134936cae5c41a91a87413cb679a))


### Documentation

* **commit-skill:** require docs sync check before src commits ([1e8cf01](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/1e8cf01ef499287ee9ba68066b8955e9cee0e189))
* rewrite README and copilot-instructions for v1.0.3+ features ([6b4d7c1](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/6b4d7c1d75a1a37c7635e598e80704ab17de23e7))

## [1.0.3](https://github.com/TD-Yofun/talkdesk-auto-deploy/compare/v1.0.2...v1.0.3) (2026-05-16)


### Features

* show release notes and disable controls when outdated ([6b9166f](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/6b9166f307055665189f0d0bf5047143430aa8e1))


### Bug Fixes

* detect Deploy (PRD) header even with emoji/icon prefix ([d07e8fb](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/d07e8fb445c3206239acfbd9e8d88ca6ff5bfdc6))

## [1.0.2](https://github.com/TD-Yofun/talkdesk-auto-deploy/compare/v1.0.1...v1.0.2) (2026-05-16)


### ⚠ BREAKING CHANGES

* GitHub token is no longer used or stored. The script now relies entirely on the in-page "Start all waiting jobs" button being visible to the current user.

### Refactor

* switch to DOM-only mode, remove github token dependency ([d26a2e4](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/d26a2e49530b9327e88f1529da1766fe126d74a0))


### Documentation

* clarify why octokit fails behind proxy in release skill ([b5c969a](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/b5c969adb549ecd9a48c5dcd3fff81a1883c0633))
* note release-it dry-run needs --ci and avoid pipes ([b9f071e](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/b9f071e760e16f3552e28b3dbaaf83259d758a00))
* require explicit user confirmation in release skill ([d2ee96f](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/d2ee96fc4f9940632e499800d25a0b5008abecb3))

## 1.0.1 (2026-05-16)


### Features

* add api-based skip fallback and persist panel visibility ([4c31e9b](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/4c31e9bcc087c64539dd4191f296b0165df7f7bc))
* add Auto-Approve Deploy Gates Tampermonkey userscript ([b55d654](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/b55d6545f50684a6168a9233d5c5a49914ca8ea6))
* add MutationObserver for real-time skip button detection ([53e9d30](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/53e9d3016f2b2044a270e892979e1b6401424084))
* enforce version check to block outdated script ([854f958](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/854f9585641646ff3db071a0fbb16936d4aa797f))
* remove close button and add url change detection ([b22bbf2](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/b22bbf247f104d3a195c725bce695cab915f2a69))
* side panel UI + execution summary report ([4b43424](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/4b434245598b9464d7e956de32468e475d1c038f))


### Bug Fixes

* persist session counters across page refreshes ([fbd6960](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/fbd6960744262676a54f694f2984fed58fdda6fb))
* remove unnecessary page refresh after approve, fix empty names, reduce poll interval ([c887dc5](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/c887dc57e7bcc1377e371a10b1fe0c8c28e662ea))
* resolve typescript error in vite config userscript type ([70506d2](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/70506d285fd9384684e265070394f86b0ed43f04))


### Refactor

* migrate to vite + typescript modular architecture ([aac24bd](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/aac24bd6e38c45bab70db84f89343f298e0ef1c2))
* optimize log storage, fix variable shadowing, improve controls disable logic ([e5e43d4](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/e5e43d48814a1b19b5d8a6056b1e31b175f23946))


### Documentation

* add .github/copilot-instructions.md ([bfccf22](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/bfccf226ae8a375b1b8b88776f4d88201c9f4469))
* add Chinese README with language toggle links ([a1ba93a](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/a1ba93aec6135df8b41f02bde2a7c2fe5ed2e9ce))
* add README ([882d46b](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/882d46b86573ff4f41500a98ed4c521bbf11ee23))
* fix inaccurate README descriptions (panel type, interval, interactions) ([35ab2fe](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/35ab2fe5f8db06561ab42568b2eb66f3193c7271))
* remove references to deleted auto-approve-deploy.sh ([baca26e](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/baca26e6305f74f1d19d6b96db72c604f41f07ca))
* replace mermaid flowcharts with ascii art ([a1f9bcf](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/a1f9bcf5c28b8a9df8273577e5760c315ed24727))
* update readme with vite+ts development guide ([837b538](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/837b538e64db6f60c7d9ee4ea67131b78a07c892))
