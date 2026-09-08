package world.theworld.server.common;

import java.util.Arrays;
import java.util.List;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

/**
 * CORS (BACKEND-CONTRACT §0): origin은 {@code theworld.cors.origins}(쉼표 구분), 헤더 content-type·x-user-id,
 * 메서드 GET/POST/PUT/DELETE/OPTIONS. 필터 맨 앞에 두어 preflight가 인증 필터에 걸리지 않게 한다.
 */
@Configuration
public class CorsConfig {
  @Bean
  public FilterRegistrationBean<CorsFilter> corsFilter(TheworldProps props) {
    CorsConfiguration c = new CorsConfiguration();
    List<String> origins = Arrays.stream(props.cors().origins().split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    for (String o : origins) {
      if (o.contains("*")) c.addAllowedOriginPattern(o); else c.addAllowedOrigin(o);
    }
    c.setAllowedHeaders(List.of("content-type", "x-user-id"));
    c.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
    c.setMaxAge(3600L);
    UrlBasedCorsConfigurationSource src = new UrlBasedCorsConfigurationSource();
    src.registerCorsConfiguration("/api/**", c);
    src.registerCorsConfiguration("/actuator/**", c);
    FilterRegistrationBean<CorsFilter> reg = new FilterRegistrationBean<>(new CorsFilter(src));
    reg.setOrder(Ordered.HIGHEST_PRECEDENCE);
    return reg;
  }
}
