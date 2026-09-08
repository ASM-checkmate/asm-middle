package world.theworld.server.auth;

import org.springframework.core.MethodParameter;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;
import world.theworld.server.common.ApiException;

/** {@code @CurrentUser AppUser} 인자 — 필터가 request attribute에 둔 사용자. 없으면(필터를 안 거친 경로) 401. */
@Component
public class CurrentUserArgumentResolver implements HandlerMethodArgumentResolver {
  @Override
  public boolean supportsParameter(MethodParameter p) {
    return p.hasParameterAnnotation(CurrentUser.class) && AppUser.class.isAssignableFrom(p.getParameterType());
  }

  @Override
  public Object resolveArgument(MethodParameter p, ModelAndViewContainer mav, NativeWebRequest req, WebDataBinderFactory binder) {
    Object user = req.getAttribute(UserIdAuthFilter.ATTR_USER, RequestAttributes.SCOPE_REQUEST);
    if (user instanceof AppUser u) return u;
    throw ApiException.unauthorized();
  }
}
