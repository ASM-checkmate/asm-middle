plugins {
    // JDK가 없으면 툴체인을 내려받는다 (Java 21) — 팀원 머신마다 JDK 설치를 강제하지 않기 위해
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}
rootProject.name = "theworld-backend"
