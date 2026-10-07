import {
  DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand,
  TransactWriteItemsCommand, UpdateItemCommand, type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import {
  CognitoIdentityProviderClient, AdminInitiateAuthCommand, AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { IdentityError, ROLES, type AuthRepository, type Clinic, type Membership, type PreSession, type StaffSession, type IdentityProvider, type CognitoResult } from './core.js';
import { createHash } from 'node:crypto';

type Item = Record<string, AttributeValue>;
const s = (value: string): AttributeValue => ({ S: value });
const n = (value: number): AttributeValue => ({ N: String(value) });
function string(item: Item, key: string): string {
  const value = (item[key] as { S?: string } | undefined)?.S;
  if (typeof value !== 'string' || !value) throw new Error(`Invalid ${key}`);
  return value;
}
function number(item: Item, key: string): number {
  const value = Number((item[key] as { N?: string } | undefined)?.N);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${key}`);
  return value;
}
function boolean(item: Item, key: string): boolean {
  const value = (item[key] as { BOOL?: boolean } | undefined)?.BOOL;
  if (typeof value !== 'boolean') throw new Error(`Invalid ${key}`);
  return value;
}

export class DynamoAuthRepository implements AuthRepository {
  private readonly client: DynamoDBClient;
  private readonly table: string;
  constructor(client: DynamoDBClient, table: string) {
    this.client = client;
    this.table = table;
  }

  private async get(pk: string, sk = 'META'): Promise<Item | null> {
    const result = await this.client.send(new GetItemCommand({
      TableName: this.table, Key: { pk: s(pk), sk: s(sk) }, ConsistentRead: true,
    }));
    return result.Item ?? null;
  }

  async getClinic(slug: string): Promise<Clinic | null> {
    const item = await this.get(`CLINIC#${slug}`);
    if (!item) return null;
    if (string(item, 'slug') !== slug) throw new Error('Clinic key mismatch');
    return { slug, displayName: string(item, 'displayName'), active: boolean(item, 'active') };
  }

  async getMembership(slug: string, username: string): Promise<Membership | null> {
    const item = await this.get(`CLINIC#${slug}`, `STAFF#${username}`);
    if (!item) return null;
    if (string(item, 'clinicSlug') !== slug || string(item, 'username') !== username) throw new Error('Membership key mismatch');
    const role = string(item, 'role') as Membership['role'];
    if (!ROLES.has(role)) throw new Error('Invalid role');
    return {
      clinicSlug: slug, username, cognitoUsername: string(item, 'cognitoUsername'),
      sub: string(item, 'sub'), displayName: string(item, 'displayName'), role, active: boolean(item, 'active'),
    };
  }

  async getPre(tokenHash: string): Promise<PreSession | null> {
    const item = await this.get(`PRE#${tokenHash}`);
    if (!item) return null;
    return { clinicSlug: string(item, 'clinicSlug'), csrfToken: string(item, 'csrfToken'), expiresAt: number(item, 'expiresAt') };
  }

  async putPre(tokenHash: string, pre: PreSession): Promise<void> {
    await this.client.send(new PutItemCommand({
      TableName: this.table,
      Item: { pk: s(`PRE#${tokenHash}`), sk: s('META'), clinicSlug: s(pre.clinicSlug), csrfToken: s(pre.csrfToken), expiresAt: n(pre.expiresAt) },
      ConditionExpression: 'attribute_not_exists(pk)',
    }));
  }

  async createSessionConsumePre(preHash: string, sessionHash: string, session: StaffSession, nowSeconds: number): Promise<boolean> {
    try {
      await this.client.send(new TransactWriteItemsCommand({ TransactItems: [
        { Delete: {
          TableName: this.table, Key: { pk: s(`PRE#${preHash}`), sk: s('META') },
          ConditionExpression: 'attribute_exists(pk) AND clinicSlug = :clinic AND expiresAt > :now',
          ExpressionAttributeValues: { ':clinic': s(session.clinicSlug), ':now': n(nowSeconds) },
        } },
        { Put: {
          TableName: this.table,
          Item: {
            pk: s(`SESSION#${sessionHash}`), sk: s('META'), clinicSlug: s(session.clinicSlug),
            username: s(session.username), sub: s(session.sub), csrfToken: s(session.csrfToken), expiresAt: n(session.expiresAt),
          },
          ConditionExpression: 'attribute_not_exists(pk)',
        } },
      ] }));
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'TransactionCanceledException') return false;
      throw error;
    }
  }

  async getSession(tokenHash: string): Promise<StaffSession | null> {
    const item = await this.get(`SESSION#${tokenHash}`);
    if (!item) return null;
    return {
      clinicSlug: string(item, 'clinicSlug'), username: string(item, 'username'), sub: string(item, 'sub'),
      csrfToken: string(item, 'csrfToken'), expiresAt: number(item, 'expiresAt'),
    };
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.client.send(new DeleteItemCommand({ TableName: this.table, Key: { pk: s(`SESSION#${tokenHash}`), sk: s('META') } }));
  }

  private failureKey(slug: string, username: string, window: number): string {
    const digest = createHash('sha256').update(`${slug}\0${username}`).digest('hex');
    return `FAIL#${digest}#${window}`;
  }

  async getFailureCount(slug: string, username: string, window: number): Promise<number> {
    const item = await this.get(this.failureKey(slug, username, window));
    return item ? number(item, 'failureCount') : 0;
  }

  async recordFailure(slug: string, username: string, window: number, expiresAt: number): Promise<void> {
    await this.client.send(new UpdateItemCommand({
      TableName: this.table,
      Key: { pk: s(this.failureKey(slug, username, window)), sk: s('META') },
      UpdateExpression: 'SET expiresAt = :expiry ADD failureCount :one',
      ExpressionAttributeValues: { ':expiry': n(expiresAt), ':one': n(1) },
    }));
  }
}

export class CognitoStaffIdentity implements IdentityProvider {
  private readonly client: CognitoIdentityProviderClient;
  private readonly userPoolId: string;
  private readonly clientId: string;
  constructor(client: CognitoIdentityProviderClient, userPoolId: string, clientId: string) {
    this.client = client;
    this.userPoolId = userPoolId;
    this.clientId = clientId;
  }

  private async user(cognitoUsername: string) {
    return this.client.send(new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: cognitoUsername }));
  }

  async authenticate(cognitoUsername: string, password: string): Promise<CognitoResult> {
    let result;
    try {
      result = await this.client.send(new AdminInitiateAuthCommand({
        UserPoolId: this.userPoolId,
        ClientId: this.clientId,
        AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: cognitoUsername, PASSWORD: password },
      }));
    } catch (error) {
      if (error instanceof Error && ['NotAuthorizedException', 'UserNotFoundException'].includes(error.name)) {
        throw new IdentityError('invalid-credentials');
      }
      if (error instanceof Error && ['TooManyRequestsException', 'LimitExceededException'].includes(error.name)) {
        throw new IdentityError('throttled');
      }
      if (error instanceof Error && error.name === 'PasswordResetRequiredException') return { kind: 'challenge' };
      throw error;
    }
    if (result.ChallengeName) return { kind: 'challenge' };
    if (!result.AuthenticationResult?.AccessToken) throw new Error('Cognito did not complete authentication');
    // Cognito tokens never leave this service; AdminGetUser supplies the stable sub.
    const user = await this.user(cognitoUsername);
    const sub = user.UserAttributes?.find((attribute) => attribute.Name === 'sub')?.Value;
    if (!user.Enabled || user.UserStatus !== 'CONFIRMED' || !sub) throw new IdentityError('invalid-credentials');
    return { kind: 'authenticated', sub };
  }

  async isActive(cognitoUsername: string, sub: string): Promise<boolean> {
    try {
      const user = await this.user(cognitoUsername);
      return Boolean(user.Enabled && user.UserStatus === 'CONFIRMED' &&
        user.UserAttributes?.some((attribute) => attribute.Name === 'sub' && attribute.Value === sub));
    } catch (error) {
      if (error instanceof Error && error.name === 'UserNotFoundException') return false;
      throw error;
    }
  }
}
