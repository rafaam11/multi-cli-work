# 개발

Node.js 22.12 이상과 npm을 사용한다. Electron 43.2.0 ABI에 맞춰 `node-pty`를 대상 플랫폼에서 네이티브로 빌드한다.

```bash
npm ci
npm run rebuild:native
npm test
npm run typecheck
npm run build
```

Linux E2E는 Ubuntu 22.04 x64의 Xvfb 데스크톱 환경과 실제 Unix PTY에서 실행한다.

로컬 패키징은 `npm run dist:win`과 `npm run dist:linux`를 사용한다. Linux 패키징은 x64 DEB와 AppImage를 생성한다.
