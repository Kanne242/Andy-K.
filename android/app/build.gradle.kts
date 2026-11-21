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
        versionCode = 1
        versionName = "1.0.0"
    }

    // Die Web-App aus /web wird direkt als Asset eingebunden.
    sourceSets["main"].assets.srcDirs("../../web")

    buildTypes {
        release {
            isMinifyEnabled = false
            // Für den Eigengebrauch mit dem Debug-Key signiert (Sideload auf Fire TV / Android TV).
            signingConfig = signingConfigs.getByName("debug")
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
