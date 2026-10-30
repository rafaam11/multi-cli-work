# Multi CLI Work (MCW)

프로젝트와 여러 PC의 Claude Code·Codex 작업을 한 화면에서 관리하는 Windows·Linux 앱입니다. v2는 독립 `mcw-host`와 Herdr에서 실행하고, 데스크톱과 폰이 같은 터미널 화면에 연결합니다.

> 공개 배포 버전과 검증 상태는 [최신 릴리스](https://github.com/rafaam11/multi-cli-work/releases/latest)와 [검증 기록](docs/release/v2-validation.json)을 확인하세요. Android 기능·실기기 검증은 이번 출시에서 제외되었습니다.

## 작업하기

1. 프로젝트에 저장소를 연결합니다. 기존 자료·메모·Git 도구는 그대로 사용합니다.
2. 프로젝트의 작업 화면에서 새 작업의 브리프, 대표의 Claude Code/Codex 프로필, 작업자 최대 3명의 프로필을 선택합니다.
3. 실행 PC를 지정하지 않은 작업자는 대표와 같은 PC에서 실행합니다. 쓰기 작업자는 각각의 worktree를 사용합니다.
4. 팀 메시지, 질문·승인 요청, 작업자별 변경·검증·산출물을 확인합니다. 결과는 미통합 상태로 남으며 합치기와 배포는 사용자가 결정합니다.

왼쪽은 프로젝트 → 저장소 → 경로/worktree → 세션입니다. `전체 / 대기`는 화면 배치와 관계없이 연결한 PC의 세션을 집계합니다. 터미널 입력·크기 제어권은 한 화면이 소유하며 다른 화면은 크기를 바꾸지 않고 관찰합니다. `idle`, 결과 제출, 사용자 확인은 서로 다른 상태입니다.

GUI 창을 닫아도 작업은 독립 호스트에서 계속됩니다. 재연결은 같은 실행을 관찰합니다. PC 재부팅으로 종료된 프로세스를 유지한 것으로 취급하거나, 전달 여부가 불명확한 실행을 자동 반복하지 않습니다.

## 다른 PC와 폰 연결

각 PC에 MCW를 설치하고 실행합니다. 연결 대상 PC의 `설정 → 원격 → 이 PC 연결 정보 복사`를 사용해 관제할 PC에 연결 정보와 SSH 주소를 입력합니다. 기존 SSH 계정과 확인된 호스트 키를 사용합니다. 프로젝트 화면에서 원격 프로젝트를 명시적으로 연결한 뒤 대표 실행 PC와 작업자 PC를 선택합니다.

폰은 각 PC의 인증된 게이트웨이에 직접 연결합니다. 최신 Android 셸은 호스트별 v1/v2 연결과 기존 pairing을 유지합니다. APK 빌드·서명 검증과 Android 기능 검증은 구분하며, 이번 출시 후보에서는 Android 기능·실기기 검증을 수행하지 않았습니다.

연결이 끊기면 마지막 관찰 시각과 저장된 결과를 표시합니다. 다른 PC에서 실행 중인 작업을 자동으로 새 대표에게 넘기거나 다시 실행하지 않습니다.

## 업데이트와 v1.55.1 복귀

기존 v1의 업데이트 확인 경로를 유지합니다. 종료된 v1의 실제 앱 데이터, 레지스트리, Electron Local Storage, 연결 정보와 mod 상태를 검증된 복구본으로 보존한 뒤 별도의 v2 데이터 루트를 초기화합니다.

`설정 → 업데이트 → v1.55.1로 돌아가기` 또는 설치 폴더 밖의 독립 복구 실행기를 사용할 수 있습니다. 원본 v1.55.1 설치본과 검증값을 함께 보존해 오프라인 복귀를 지원합니다. 관련 작업이 정리되고 호스트 상태를 확인한 뒤 진행하며, 사용자가 수정한 공유 설정과 충돌하면 해당 복원을 보류합니다.

복귀는 업데이트 전 v1 앱 데이터를 기준으로 합니다. Git 코드·worktree·Claude/Codex 대화 기록과 v2 결과는 되감지 않습니다. 복원한 v1에서는 자동 업데이트 확인, 세션 자동 재개, 세션 시작 시 레포 동기화를 끕니다. 다시 v2로 업데이트할 때 보존된 v2 상태를 사용하고 복귀 기간의 v1 변경은 자동으로 합치지 않습니다.

[복구 실행기 상세](scripts/recovery/README.md) · [원본 v1.55.1](https://github.com/rafaam11/multi-cli-work/releases/tag/v1.55.1)

## v1에서 달라진 인터페이스

v2는 `jk` CLI/MCP와 호환 별칭을 제공하지 않습니다. 실행은 Herdr가 담당하고, 작업용 MCP는 작업 조회·배정·팀 메시지·수신 대기·결과 제출·취소 요청을 처리합니다. 기본 프리셋은 새 인터페이스를 사용합니다. 사용자 수정 프롬프트와 과거 보드·대화 기록은 보존하며 필요한 이관을 표시합니다. 표시용 칩은 실행 상태와 분리된 Herdr metadata입니다.

[v1.55.1 사용 안내와 이전 인터페이스](README-v1.md)는 복귀 후 참고할 수 있도록 별도로 보존합니다.

## 개발과 검증

Node.js 22.12 이상과 Rust 도구 모음이 필요합니다. 플랫폼별 고정 자산·원본 복구 설치본은 manifest의 SHA-256으로 검증합니다.

```sh
npm ci --ignore-scripts
node node_modules/electron/install.js
node scripts/v2/assets.mjs --download --platform win32
npm run build:v2
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --exclude src/main/providers/claude-integration.test.ts
npx vitest run src/main/providers/claude-integration.test.ts --maxWorkers=1
```

Linux에서는 자산의 플랫폼을 `linux`로 지정합니다. 원본 설치본을 사용하는 복귀 왕복 검증은 격리된 CI에서 실행합니다. 일반 개발 PC에 원본 설치기를 실행하지 않습니다. 사전 검증 패키지는 stable/latest와 분리되며, 출시 검증 기록에 통과 근거가 없으면 정식 배포가 차단됩니다.

[변경 내역](docs/release/v2.0.0.md) · [구현·출시 조건](docs/superpowers/plans/2026-10-30-herdr-v2.md) · [검증 근거](docs/release/evidence/v2/)
