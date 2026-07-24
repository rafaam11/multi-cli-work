# 설치

v1.6.0은 Windows 10 1809+와 Ubuntu 22.04 x64를 지원한다.

## Windows

Releases의 `Multi-CLI-Work-Setup-1.6.0.exe`를 실행한다. 사용자 단위 NSIS 설치이며 SmartScreen이 표시되면 게시자를 확인한 뒤 진행한다.

## Ubuntu 22.04 x64

DEB가 기본 설치 방식이다.

```bash
sudo apt install ./Multi-CLI-Work-1.6.0-linux-x64.deb
```

DEB는 `python3`를 포함한 런타임 의존성을 선언한다.

AppImage는 FUSE2가 필요 없는 정적 runtime toolset 1.0.3으로 빌드된다.

```bash
chmod +x Multi-CLI-Work-1.6.0-linux-x64.AppImage
./Multi-CLI-Work-1.6.0-linux-x64.AppImage
```

데스크톱 GUI 세션이 필요하며 headless 실행은 공식 지원하지 않는다.
