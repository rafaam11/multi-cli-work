# Android validation deferral for MCW v2.0.0

On 2026-10-30, the project owner explicitly instructed:

> Android 검증을 제외한 기능 구현까지 쭉 해보고 배포까지 쭉 진행해 줘.

This supersedes the earlier requirement to run Android verification last before
publishing. Android functionality and distribution remain in scope; Android
verification is excluded from this release gate by the owner.

The eight Android checks are **deferred**, not passed. They have no tested source
commit, completion time, or tester. This file records authorization, not test
evidence. The release notes must disclose that Android verification was not
performed. Windows, Linux, collaboration and offline recovery gates are unchanged.
