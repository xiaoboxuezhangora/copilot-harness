import { MemoryPolicyError } from "./errors.js";
import type { RedlineMatch } from "./types.js";

interface RedlineRule {
  readonly id: string;
  readonly description: string;
  readonly pattern: RegExp;
}

const REDLINE_RULES: readonly RedlineRule[] = [
  {
    id: "phi",
    description: "PHI or clinical record details are not allowed in memory",
    pattern: /(protected health information|病案|病历|诊断记录|检验结果)/i,
  },
  {
    id: "patient_identifier",
    description: "real patient identifiers are not allowed in memory",
    pattern:
      /(patient(?:_?id|_?no)|inpatient(?:_?id|_?no)|患者(?:编号|标识|姓名|证件)|身份证号?|住院号)/i,
  },
  {
    id: "sso_token",
    description: "SSO token or ticket is not allowed in memory",
    pattern:
      /(sso[_-]?(?:token|ticket)|session(?:id)?\s*[:=]\s*[A-Za-z0-9._-]{8,})/i,
  },
  {
    id: "ca_private_key",
    description: "CA private key is not allowed in memory",
    pattern:
      /(-----BEGIN (?:RSA |EC |)PRIVATE KEY-----|ca[^\n]{0,12}(?:private key|私钥))/i,
  },
  {
    id: "pda_key",
    description: "PDA key or token is not allowed in memory",
    pattern: /(pda[_-]?(?:key|secret|token)|PDA[^\n]{0,8}(?:密钥|秘钥|令牌))/i,
  },
  {
    id: "transfusion_reaction_raw_text",
    description: "raw transfusion reaction text is not allowed in memory",
    pattern: /(transfusion reaction|输血反应).{0,20}(?:原文|详情|全文|记录)/i,
  },
  {
    id: "platform_credentials",
    description: "platform credentials are not allowed in memory",
    pattern:
      /(client_secret|app_secret|access_key|secret_key|platform[_-]?(?:credential|secret|token)|平台(?:凭证|密钥|令牌))/i,
  },
  {
    id: "authorization_bearer",
    description: "Authorization/Bearer token is not allowed in memory",
    pattern:
      /(authorization\s*:\s*bearer\s+[a-z0-9\-._~+/]+=*|\bbearer\s+[a-z0-9\-._~+/]+=*)/i,
  },
  {
    id: "sensitive_request_response_dump",
    description: "complete sensitive request/response payload is not allowed",
    pattern:
      /(full\s+(?:request|response)|raw\s+(?:request|response)|完整(?:敏感)?(?:请求|响应)|(?:request|response)\s*body\s*[:=])/i,
  },
];

export function assertMemoryRedline(
  fields: Readonly<Record<string, string | undefined>>,
): void {
  const matches = findRedlineMatches(fields);
  if (matches.length === 0) {
    return;
  }

  const ruleIds = [...new Set(matches.map((item) => item.rule_id))];
  const violatedFields = [...new Set(matches.map((item) => item.field))];

  throw new MemoryPolicyError("memory put rejected by redline policy", {
    rule_ids: ruleIds,
    fields: violatedFields,
  });
}

export function findRedlineMatches(
  fields: Readonly<Record<string, string | undefined>>,
): readonly RedlineMatch[] {
  const matches: RedlineMatch[] = [];

  for (const [field, rawValue] of Object.entries(fields)) {
    if (rawValue === undefined || rawValue.length === 0) {
      continue;
    }

    for (const rule of REDLINE_RULES) {
      if (rule.pattern.test(rawValue)) {
        matches.push({
          field,
          rule_id: rule.id,
          description: rule.description,
        });
      }
    }
  }

  return matches;
}
