package com.rafaam11.multicliwork.mobile.update

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ApkVerifierTest {
    @Test
    fun acceptsOnlyTheAdvertisedVersionThatIsNewerThanInstalled() {
        assertTrue(ApkVerifier.versionAcceptable(archive = 3, advertised = 3, installed = 2))
    }

    @Test
    fun rejectsAVersionThatDiffersFromTheAdvertisedOne() {
        assertFalse(ApkVerifier.versionAcceptable(archive = 2, advertised = 3, installed = 1))
        assertFalse(ApkVerifier.versionAcceptable(archive = 4, advertised = 3, installed = 1))
    }

    @Test
    fun rejectsADowngradeOrSameVersion() {
        assertFalse(ApkVerifier.versionAcceptable(archive = 2, advertised = 2, installed = 2))
        assertFalse(ApkVerifier.versionAcceptable(archive = 1, advertised = 1, installed = 2))
    }
}
