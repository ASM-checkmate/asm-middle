package world.theworld.server.auth;

import org.springframework.data.jpa.repository.JpaRepository;

/** 고정 아이디 5명 — findById·existsById·findAll(Sort)면 충분하다. */
public interface AppUserRepository extends JpaRepository<AppUser, String> {}
