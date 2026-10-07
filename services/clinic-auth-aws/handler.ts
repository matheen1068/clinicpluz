import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { createAuthApp } from './src/core.js';
import { DynamoAuthRepository, CognitoStaffIdentity } from './src/aws.js';
import { fromHttpApiEvent, invalidHttpApiEvent, type HttpApiEvent } from './src/http-api.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const secrets = new SecretsManagerClient({});
let appPromise: ReturnType<typeof initialize> | undefined;

async function initialize() {
  const edgeSecret = await secrets.send(new GetSecretValueCommand({ SecretId: required('EDGE_SECRET_ARN') }));
  if (!edgeSecret.SecretString) throw new Error('Edge secret unavailable');
  return createAuthApp(
    new DynamoAuthRepository(new DynamoDBClient({}), required('AUTH_TABLE')),
    new CognitoStaffIdentity(new CognitoIdentityProviderClient({}), required('USER_POOL_ID'), required('USER_POOL_CLIENT_ID')),
    { publicOrigin: required('PUBLIC_ORIGIN'), edgeKey: edgeSecret.SecretString },
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
    return { statusCode: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: '{"error":"Clinic sign-in is temporarily unavailable"}' };
  }
}
