# Control Panel diagnostics design

## Goal

Give ClinicPluz operators a reliable way to identify which branch, service, and workflow step is failing without turning routine platform access into access to patient records. Diagnostics report observed evidence and the time it was observed. An uninstrumented or unreachable service is **unknown**, never healthy.

## Operator experience

An operator opens **Diagnostics**, selects a customer and branch, and sees:

1. **Branch readiness:** active/suspended state, clinic administrator membership, enabled modules, and configuration versions. These are direct checks of authoritative control records.
2. **Service signals:** request volume, error rate, throttles, latency, and most recent successful check, grouped by Clinic App service when sanitized telemetry exists. Each signal names its source and observation window. Services without telemetry display **Not instrumented**.
3. **Recent failures:** time, service, route or workflow step, stable error code, correlation/request ID, and status. Do not show request bodies, patient names, phone numbers, prescription contents, or free-text clinical fields.
4. **Guided investigation:** a request ID can link booking, consultation, prescription handoff, billing, and email-delivery events when those services emit the same correlation ID. Show where a flow stopped; do not infer a successful final step from an earlier success.

For a report that a patient record is missing, routine diagnostics can answer whether a branch's service is operating and identify a failed request. A separate, time-limited, read-only support workflow may later check one patient or appointment ID after an explicit reason and authorization are recorded. That workflow has its own role, API, IAM permissions, audit trail, and result masking. It is outside routine Diagnostics access.

## AWS boundary

The Control Panel has its own CloudFront distribution, private S3 bucket, operator identity pool, API Gateway, and compute. The Clinic App keeps its own website and runtime. Both may use shared clinic identity/configuration records through narrow permissions. Routine diagnostics must not gain a clinical-table permission or a CloudWatch Logs wildcard read permission.

Clinic services emit structured, redacted operational events and metrics. A collection path can publish aggregated service metrics to CloudWatch and bounded diagnostic event summaries to a separate, tenant-keyed store with retention. The Control API reads only those summaries through branch-scoped, paginated endpoints. The browser never calls CloudWatch or clinical services directly. A separate support API is required for exceptional patient-record investigation.

## First implementation boundary

The first slice should show only checks backed by the existing control records and explicitly identify missing telemetry. It must not present placeholder metrics, fabricated timelines, or a general claim that the Clinic App is healthy. Instrumenting clinic request paths, collecting sanitized events, and adding alerts are subsequent work before diagnosing runtime failures from this screen.

## Safety and verification

- Authorize every query for an individually allowlisted operator and an exact branch; never trust a browser-provided branch label alone.
- Bound the time window and page size. Do not expose raw logs or arbitrary log search.
- Do not log payloads or patient identifiers in diagnostic events. Use opaque correlation IDs and documented stable error codes.
- Keep audit events for operator actions and for exceptional support lookups; define retention and access review before real patient data.
- Test multi-branch isolation, missing telemetry, stale signals, failure states, and a deliberately broken clinic dependency. Load-test clinic workflows separately from the operator dashboard.

The first release remains a synthetic staging pilot. Patient-data support access requires a separate privacy and operations review.
