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

PR과 `main`은 unit·typecheck·build를 실행한다. PR은 Windows 핵심 smoke를 추가로 실행하고, `main`과 release tag는 실제 Electron 전체 E2E를 실행한다. tag는 E2E가 끝난 플랫폼에서 NSIS 또는 DEB·AppImage를 패키징한다.

## 외부 통신

앱은 사용자가 요청한 GitHub PR 조회·댓글, `git fetch`/`pull`/`push`, GitHub 링크 열기와 자동 업데이트 확인·다운로드를 위해 네트워크를 사용한다. PR Files의 비공개 line note는 GitHub에 게시하지 않고 로컬 registry에서 현재 review PTY로만 전달한다. GitHub 인증 정보는 앱이 저장하지 않으며 시스템 `git`과 `gh` CLI가 관리한다.
# PR 리뷰 세션 보안

PR 리뷰 세션은 일반 Claude Code/Codex 세션과 동일하게 승인 및 샌드박스 우회 옵션으로
실행되며 저장소에 문서화된 테스트를 자동 실행하도록 지시합니다. 이 설정은 신뢰할 수 없는
PR 코드를 격리 없이 실행할 수 있으므로 격리된 개발 환경에서만 사용하는 것을 권장합니다.
앱은 GitHub 토큰이나 PR 본문·코멘트를 저장하지 않으며 인증은 `gh` CLI가 관리합니다.
