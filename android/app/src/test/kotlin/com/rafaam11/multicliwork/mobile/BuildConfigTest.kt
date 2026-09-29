package com.rafaam11.multicliwork.mobile

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.util.Properties

class BuildConfigTest {
    @Test
    fun versionComesFromVersionProperties() {
        val props = Properties().apply { File("../version.properties").inputStream().use(::load) }
        assertEquals(props.getProperty("shellVersionCode").toInt(), BuildConfig.VERSION_CODE)
        assertEquals(props.getProperty("shellVersionName"), BuildConfig.VERSION_NAME)
    }
}
