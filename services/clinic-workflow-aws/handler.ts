import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { createWorkflowApp } from './src/core.js';
import { CognitoStaffStatus, DynamoAuthStore, DynamoWorkflowStore } from './src/aws.js';
import { fromHttpApiEvent, invalidHttpApiEvent, type HttpApiEvent } from './src/http-api.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const secrets = new SecretsManagerClient({});
let appPromise: ReturnType<typeof initialize> | undefined;
async function initialize() {
  const key = await secrets.send(new GetSecretValueCommand({ SecretId: required('EDGE_SECRET_ARN') }));
  if (!key.SecretString) throw new Error('Edge secret unavailable');
  const db = new DynamoDBClient({});
  const emailEnabled = process.env.PRESCRIPTION_EMAIL_ENABLED === 'true';
  if (emailEnabled && process.env.STAGE_NAME !== 'staging') throw new Error('Demo email requires staging');
  const sender = emailEnabled ? required('PRESCRIPTION_EMAIL_SENDER') : '';
  const allowedRecipient = emailEnabled ? required('PRESCRIPTION_EMAIL_ALLOWED_RECIPIENT') : '';
  // SES SendEmail has no idempotency token. The database claim is the only send attempt;
  // SDK retries must stay disabled when a transport outcome is ambiguous.
  const ses = emailEnabled ? new SESv2Client({ maxAttempts: 1 }) : null;
  return createWorkflowApp(
    new DynamoAuthStore(db, required('AUTH_TABLE')),
    new CognitoStaffStatus(new CognitoIdentityProviderClient({}), required('STAFF_USER_POOL_ID')),
    new DynamoWorkflowStore(db, required('CLINICAL_TABLE')),
    { publicOrigin: required('PUBLIC_ORIGIN'), edgeKey: key.SecretString,
      ...(ses ? { prescriptionEmail: { allowedRecipient,
        async send(to: string, pdf: Uint8Array): Promise<string> {
          const reply = await ses.send(new SendEmailCommand({
            FromEmailAddress: sender, Destination: { ToAddresses: [to] },
            Content: { Simple: {
              Subject: { Data: 'ClinicPluz synthetic demo prescription' },
              Body: { Text: { Data: 'A synthetic demo prescription is attached. Do not use it for care.' } },
              Attachments: [{ FileName: 'clinicpluz-demo-prescription.pdf',
                ContentType: 'application/pdf', ContentDisposition: 'ATTACHMENT',
                ContentTransferEncoding: 'BASE64', RawContent: pdf }],
            } },
          }));
          if (!reply.MessageId) throw new Error('SES acceptance unavailable');
          return reply.MessageId;
        },
      } } : {}),
    },
  );
}

export async function handler(event: HttpApiEvent) {
  const input = fromHttpApiEvent(event);
  if (!input) return invalidHttpApiEvent();
  try {
    appPromise ??= initialize();
    return await (await appPromise).handle(input);
  } catch {
    appPromise = undefined;
    return { statusCode: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: '{"error":"Clinic workflow temporarily unavailable"}' };
  }
}
