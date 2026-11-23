plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "de.akm.tube"
    compileSdk = 35

    defaultConfig {
        applicationId = "de.akm.tube"
        minSdk = 22            // Fire TV Stick (Fire OS 5+) und ältere Android-TV-Boxen
        targetSdk = 35
        // Bei jedem Build in GitHub Actions automatisch hochgezählt, damit Updates sich drüber installieren lassen
        val build = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionCode = build
        versionName = "1.0.$build"
    }

    // Die Web-App aus /web wird direkt als Asset eingebunden.
    sourceSets["main"].assets.srcDirs("../../web")

    // Fester App-Schlüssel, damit Updates sich über die bestehende Installation installieren lassen.
    // In GitHub Actions kommt er aus den Secrets AKM_KEYSTORE_BASE64 / AKM_KEYSTORE_PASSWORD.
    // Fehlt er, wird mit dem Debug-Schlüssel signiert (dann vor einem Update deinstallieren).
    val akmKeystore = rootProject.file("akmtube.keystore")
    val akmPassword = System.getenv("AKM_KEYSTORE_PASSWORD")
    signingConfigs {
        if (akmKeystore.exists() && !akmPassword.isNullOrEmpty()) {
            create("akm") {
                storeFile = akmKeystore
                storePassword = akmPassword
                keyAlias = "akmtube"
                keyPassword = akmPassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("akm") ?: signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}
