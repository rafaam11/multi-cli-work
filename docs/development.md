# 개발

단일 Electron 프로젝트(electron-vite)다. 모든 명령은 저장소 루트에서 실행한다.

## 준비

Node.js 22.12 이상과 npm이 필요하다. `node-pty`는 네이티브 모듈이라 Electron 43.2.0의 ABI에 맞춰
**대상 플랫폼에서 직접** 빌드해야 한다 — 다른 OS에서 만든 `node_modules`를 옮겨 쓸 수 없다.

```bash
git clone https://github.com/rafaam11/multi-cli-work.git
cd multi-cli-work
npm ci
npm run dev
```

`npm ci`의 `postinstall`이 `electron-builder install-app-deps`를 돌려 네이티브 모듈을 맞춘다.
Electron 버전을 올린 뒤 PTY가 열리지 않으면 `npm run rebuild:native`로 다시 맞춘다.

## 스크립트

| 스크립트 | 설명 |
|---|---|
| `npm run dev` | electron-vite 개발 모드(main/preload/renderer HMR + Electron 창) |
| `npm start` | `electron-vite preview` — 빌드된 번들을 그대로 띄운다 |
| `npm test` | vitest 유닛 테스트 |
| `npm run test:watch` | vitest watch 모드 |
| `npm run typecheck` | TypeScript 타입 검사(`tsconfig.node.json` + `tsconfig.web.json` 2패스) |
| `npm run build` | typecheck + 프로덕션 번들(`out/`) |
| `npm run test:e2e` | 빌드 후 Playwright로 **실제 ConPTY/Unix PTY 세션**을 Electron에서 구동 |
| `npm run test:e2e:smoke` | PR용 Windows 핵심 경로 smoke 묶음(`--grep @smoke`) |
| `npm run dist` / `npm run dist:win` | Windows NSIS 설치본 빌드 |
| `npm run dist:linux` / `npm run dist:linux:x64` | Linux x64 DEB·AppImage 빌드 |
| `npm run rebuild:native` | `node-pty`를 현재 Electron ABI로 재빌드 |
| `npm run icons:extract` | 파일 트리가 쓰는 Material Icon Theme 글리프를 `scripts/extract-file-icons.mjs`로 추출 |
| `postinstall` | `npm ci` 뒤 자동 실행 — `electron-builder install-app-deps` |

`icons:extract`의 결과물은 **저장소에 커밋된다**. 파일 트리 아이콘을 위해 런타임 의존성이
늘지 않도록, 아이콘 테마는 개발 시점에 글리프로 뽑아 두고 앱은 그것만 싣는다.

## 테스트

- **유닛** — vitest. 순수 모듈(레지스트리 검증, 레이아웃 계산, 상태 판정, 패인 컨텍스트 분해)과
  렌더러 컴포넌트를 `@testing-library/react` + jsdom으로 덮는다. 테스트는 대상 파일 옆에 둔다.
- **E2E** — Playwright가 패키징된 Electron을 띄우고 **실제 PTY 세션**을 굴린다. 모킹한 터미널이
  아니므로 ConPTY·Unix PTY의 실제 동작 차이가 여기서 잡힌다. Linux는 Xvfb 데스크톱이 필요하다.

## CI

| 트리거 | 실행 |
|---|---|
| PR | `verify`(ubuntu-22.04: test·typecheck·build) + `windows-smoke`(windows-2022: `test:e2e:smoke`) |
| `main` push | `verify` + `full-electron-e2e`(windows-2022·ubuntu-22.04 매트릭스, 전체 `test:e2e`) |
| `v*` 태그 | 아래 릴리스 절차 |

CI는 Node.js 22.12.0으로 고정하고, E2E 잡은 Claude 상태 훅에 필요한 Python 3.11을 함께 설치한다.

## 릴리스

`v*` 태그를 푸시하면:

1. `verify-version` — 태그 이름과 `package.json` 버전이 어긋나면 여기서 멈춘다
2. `windows`(windows-2022) / `linux`(ubuntu-22.04) — 각자 `npm test` → 전체 `npm run test:e2e` →
   `electron-builder` 패키징 → 아티팩트 업로드
3. 마지막 잡이 두 플랫폼 아티팩트를 모아 **하나의 draft 릴리스**에 올린다

릴리스 노트는 `docs/release/<버전>.md`에 남긴다.

## 요구사항

Windows 10 1809 이상 또는 Ubuntu 22.04 x64. macOS, Ubuntu 20.04 이하, 기타 CPU 아키텍처,
headless 환경은 현재 공식 범위가 아니다.

## 외부 통신

앱은 사용자가 요청한 GitHub PR 조회·댓글, `git fetch`/`pull`/`push`, GitHub 링크 열기와
자동 업데이트 확인·다운로드를 위해서만 네트워크를 사용한다. 그 밖의 통신은 없다.
PR Files의 비공개 line note는 GitHub에 게시하지 않고 로컬 registry에서 현재 review PTY로만
전달한다. GitHub 인증 정보는 앱이 저장하지 않으며 시스템 `git`과 `gh` CLI가 관리한다.

## PR 리뷰 세션 보안

PR 리뷰 세션은 일반 Claude Code/Codex 세션과 동일하게 승인 및 샌드박스 우회 옵션으로 실행되며,
저장소에 문서화된 테스트를 자동 실행하도록 지시한다. 이 설정은 **신뢰할 수 없는 PR 코드를 격리
없이 실행할 수 있으므로** 격리된 개발 환경에서만 쓰는 것을 권장한다. 앱은 GitHub 토큰이나
PR 본문·코멘트를 저장하지 않으며 인증은 `gh` CLI가 관리한다.
