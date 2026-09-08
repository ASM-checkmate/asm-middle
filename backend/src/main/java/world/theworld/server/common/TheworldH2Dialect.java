package world.theworld.server.common;

import java.sql.Types;
import org.hibernate.dialect.H2Dialect;
import org.hibernate.type.SqlTypes;

/**
 * H2(dev·test) 전용 방언. V1__init.sql의 {@code text} 컬럼은 H2에서 CLOB, PostgreSQL에서 varchar 계열로 보고되는데
 * 엔티티는 한 가지({@code @JdbcTypeCode(LONG32VARCHAR)} — PostgreSQL 방언이 "text"로 내는 코드)로 매핑해야 하므로
 * H2 쪽에서만 "긴 문자열 ≈ CLOB"으로 보아 {@code ddl-auto: validate}가 통과하게 한다 (BACKEND-CONTRACT §1).
 * prod 프로필은 표준 PostgreSQLDialect를 쓴다.
 */
public class TheworldH2Dialect extends H2Dialect {
  @Override
  protected String columnType(int sqlTypeCode) {
    return switch (sqlTypeCode) {
      case SqlTypes.LONG32VARCHAR, SqlTypes.LONG32NVARCHAR -> "character large object";
      default -> super.columnType(sqlTypeCode);
    };
  }

  @Override
  public boolean equivalentTypes(int typeCode1, int typeCode2) {
    return super.equivalentTypes(typeCode1, typeCode2) || (longText(typeCode1) && longText(typeCode2));
  }

  private static boolean longText(int code) {
    return code == Types.CLOB || code == Types.NCLOB || code == SqlTypes.LONG32VARCHAR || code == SqlTypes.LONG32NVARCHAR || SqlTypes.isVarcharType(code);
  }
}
