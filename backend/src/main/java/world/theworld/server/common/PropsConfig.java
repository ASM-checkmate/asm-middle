package world.theworld.server.common;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/** {@code theworld.*} 설정 바인딩 켜기 — 애플리케이션 클래스는 건드리지 않고 여기서. */
@Configuration
@EnableConfigurationProperties(TheworldProps.class)
public class PropsConfig {}
