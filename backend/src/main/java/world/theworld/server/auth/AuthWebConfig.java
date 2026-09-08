package world.theworld.server.auth;

import java.util.List;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** {@code @CurrentUser} 아규먼트 리졸버 등록. */
@Configuration
public class AuthWebConfig implements WebMvcConfigurer {
  private final CurrentUserArgumentResolver currentUser;

  public AuthWebConfig(CurrentUserArgumentResolver currentUser) { this.currentUser = currentUser; }

  @Override
  public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
    resolvers.add(currentUser);
  }
}
