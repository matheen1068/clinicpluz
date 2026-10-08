import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
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
  return createWorkflowApp(
    new DynamoAuthStore(db, required('AUTH_TABLE')),
    new CognitoStaffStatus(new CognitoIdentityProviderClient({}), required('STAFF_USER_POOL_ID')),
    new DynamoWorkflowStore(db, required('CLINICAL_TABLE')),
    { publicOrigin: required('PUBLIC_ORIGIN'), edgeKey: key.SecretString },
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
