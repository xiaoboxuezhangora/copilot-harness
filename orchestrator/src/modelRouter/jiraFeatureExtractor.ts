import type {
  JiraEvidenceFieldValueV2,
  JiraEvidencePackV2
} from '../jira/evidence.js';
import type { JiraFeatureInput, JiraFeatures } from './types.js';

export class JiraFeatureExtractor {
  extract(input: JiraFeatureInput): JiraFeatures {
    const customFields = normalizeCustomFields(input.customFields ?? {});
    const riskLevel =
      input.riskLevel ?? readStringCustomField(customFields, 'riskLevel', 'risk_level');
    const businessDomain =
      input.businessDomain ??
      readStringCustomField(customFields, 'businessDomain', 'business_domain', 'issueCategory');
    const dataClassification =
      input.dataClassification ??
      readStringCustomField(customFields, 'dataClassification', 'data_classification');

    return {
      ...(input.projectKey !== undefined ? { projectKey: input.projectKey } : {}),
      ...(input.issueType !== undefined ? { issueType: input.issueType } : {}),
      labels: [...(input.labels ?? [])],
      components: (input.components ?? [])
        .map((component) => (typeof component === 'string' ? component : component.name ?? ''))
        .filter((component) => component.trim().length > 0),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      customFields,
      ...(riskLevel !== undefined ? { riskLevel } : {}),
      ...(businessDomain !== undefined ? { businessDomain } : {}),
      ...(dataClassification !== undefined ? { dataClassification } : {})
    };
  }

  fromJiraEvidencePackV2(pack: JiraEvidencePackV2): JiraFeatures {
    const customFields = customFieldsFromEvidence(pack.fieldValues);
    const components = pack.projectMetadata?.components.map((component) => component.name) ?? [];
    return this.extract({
      projectKey: pack.issue.projectKey,
      issueType: pack.issue.issueType,
      labels: pack.issue.labels,
      components,
      priority: pack.issue.priority,
      customFields
    });
  }
}

function customFieldsFromEvidence(
  fieldValues: readonly JiraEvidenceFieldValueV2[]
): Readonly<Record<string, string | readonly string[]>> {
  const output: Record<string, string | readonly string[]> = {};
  for (const fieldValue of fieldValues) {
    if (fieldValue.valueKind === 'string' && fieldValue.valueString !== undefined) {
      output[fieldValue.fieldKey] = fieldValue.valueString;
    }
    if (fieldValue.valueKind === 'string_list' && fieldValue.valueStrings !== undefined) {
      output[fieldValue.fieldKey] = [...fieldValue.valueStrings];
    }
  }
  return output;
}

function normalizeCustomFields(
  fields: Readonly<Record<string, unknown>>
): Readonly<Record<string, string | readonly string[]>> {
  const output: Record<string, string | readonly string[]> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string') {
      output[key] = value;
    } else if (Array.isArray(value)) {
      const strings = value.filter((item): item is string => typeof item === 'string');
      if (strings.length === value.length) {
        output[key] = strings;
      }
    }
  }
  return output;
}

function readStringCustomField(
  fields: Readonly<Record<string, string | readonly string[]>>,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}
