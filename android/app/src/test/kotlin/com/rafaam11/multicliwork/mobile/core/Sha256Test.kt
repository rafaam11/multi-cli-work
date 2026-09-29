package com.rafaam11.multicliwork.mobile.core

import org.junit.Assert.assertEquals
import org.junit.Test

class Sha256Test {
    @Test
    fun hashesAStream() {
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            Sha256.hex("abc".byteInputStream()),
        )
    }

    @Test
    fun hashesAcrossBufferBoundaries() {
        val big = ByteArray(200_000) { (it % 251).toByte() }
        val expected = java.security.MessageDigest.getInstance("SHA-256").digest(big).joinToString("") { "%02x".format(it) }
        assertEquals(expected, Sha256.hex(big.inputStream()))
    }
}
