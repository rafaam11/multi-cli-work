import java.io.FileInputStream
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

val shellVersion = Properties().apply { rootProject.file("version.properties").inputStream().use(::load) }

// 릴리스 서명: 로컬은 레포 밖 keystore.properties(기본 ~/.multi-cli-work-signing/), CI는 MCW_ANDROID_* env.
// 둘 다 없으면 release 빌드에 서명을 붙이지 않는다(키 없는 환경에서도 assembleRelease는 된다).
val keystoreProperties = Properties().apply {
    val path = System.getenv("MCW_ANDROID_KEYSTORE_PROPERTIES")
        ?: "${System.getProperty("user.home")}/.multi-cli-work-signing/keystore.properties"
    val file = File(path)
    if (file.exists()) FileInputStream(file).use(::load)
}
fun signingValue(key: String, env: String): String? = System.getenv(env) ?: keystoreProperties.getProperty(key)
val releaseStoreFile = signingValue("storeFile", "MCW_ANDROID_KEYSTORE_PATH")

android {
    namespace = "com.rafaam11.multicliwork.mobile"
    compileSdk = 37
    defaultConfig {
        applicationId = "com.rafaam11.multicliwork.mobile"
        minSdk = 31
        targetSdk = 37
        versionCode = shellVersion.getProperty("shellVersionCode").toInt()
        versionName = shellVersion.getProperty("shellVersionName")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    signingConfigs {
        create("release") {
            if (releaseStoreFile != null) {
                storeFile = file(releaseStoreFile)
                storePassword = signingValue("storePassword", "MCW_ANDROID_KEYSTORE_PASSWORD")
                keyAlias = signingValue("keyAlias", "MCW_ANDROID_KEY_ALIAS")
                keyPassword = signingValue("keyPassword", "MCW_ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            if (releaseStoreFile != null) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
        }
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.activity.compose)
    implementation(libs.core.ktx)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.coroutines.android)
    implementation(libs.serialization.json)
    implementation(libs.code.scanner)
    debugImplementation(libs.compose.ui.tooling)
    testImplementation(libs.junit)
}
