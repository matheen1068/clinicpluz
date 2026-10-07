import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { createControlApp } from './src/core.js';
import { DynamoControlRepository, CognitoStaffLookup } from './src/aws.js';
import { fromHttpApiEvent, invalidHttpApiEvent, type HttpApiEvent } from './src/http-api.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

let app: ReturnType<typeof createControlApp> | undefined;
function initialize() {
  const allowed = new Set(required('ALLOWED_OPERATOR_SUBS').split(',').map((value) => value.trim()).filter(Boolean));
  return createControlApp(
    new DynamoControlRepository(new DynamoDBClient({}), required('AUTH_TABLE')),
    new CognitoStaffLookup(new CognitoIdentityProviderClient({}), required('STAFF_USER_POOL_ID')),
    { publicOrigin: required('PUBLIC_ORIGIN'), operatorIssuer: required('OPERATOR_ISSUER'),
      operatorClientId: required('OPERATOR_CLIENT_ID'), allowedOperatorSubs: allowed },
  );
}

export async function handler(event: HttpApiEvent) {
  const input = fromHttpApiEvent(event);
  if (!input) return invalidHttpApiEvent();
  try {
    app ??= initialize();
    return await app.handle(input);
  } catch {
    return { statusCode: 503,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: '{"error":"Control Panel temporarily unavailable"}' };
  }
}
