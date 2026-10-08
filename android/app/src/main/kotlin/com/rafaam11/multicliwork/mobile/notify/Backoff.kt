package com.rafaam11.multicliwork.mobile.notify

/**
 * 재연결 간격. 데스크톱 상태 연결(1·2·5·10초)보다 길게 늘린다 — 폰은 Tailscale이 꺼진 채로 오래 있을 수
 * 있고, 그동안 배터리를 쓰며 두드릴 이유가 없다. 네트워크가 돌아오면 reset하고 바로 붙는다.
 */
class Backoff(private val delaysMs: List<Long> = listOf(1_000, 2_000, 5_000, 10_000, 30_000, 60_000)) {
    private var attempt = 0

    fun next(): Long = delaysMs[minOf(attempt++, delaysMs.lastIndex)]

    fun reset() {
        attempt = 0
    }
}
