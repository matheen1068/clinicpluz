import { randomUUID } from 'node:crypto';
import { DynamoDBClient, GetItemCommand, QueryCommand, TransactWriteItemsCommand,
  type AttributeValue, type TransactWriteItem } from '@aws-sdk/client-dynamodb';
import type { BillingConfig, BillingStore, BillingWrite, BillCharge, BillEpisode,
  BillOperation, BillPayment, BillReceipt, FulfillmentEvent, EpisodeRecords } from './billing.js';
import { validPaise } from './billing.js';

type Item = Record<string, AttributeValue>;
const s = (value: string): AttributeValue => ({ S: value });
const n = (value: number): AttributeValue => ({ N: String(value) });
const billingPk = (slug: string, id: string) => `CLINIC#${slug}#BILL#${id}`;
const indexPk = (slug: string, date: string) => `CLINIC#${slug}#BILLING#${date}`;
function json<T>(item: Item, key: string): T {
  const raw = (item.document as { S?: string } | undefined)?.S;
  if (!raw || raw.length > 100_000) throw new Error(`Invalid ${key} document`);
  return JSON.parse(raw) as T;
}
function put(table: string, pk: string, sk: string, document: unknown, condition = 'attribute_not_exists(pk)'): TransactWriteItem {
  return { Put: { TableName: table, Item: { pk: s(pk), sk: s(sk), document: s(JSON.stringify(document)) },
    ConditionExpression: condition } };
}

export class DynamoBillingStore implements BillingStore {
  constructor(private readonly client: DynamoDBClient, private readonly table: string) {}
  private async get(pk: string, sk: string): Promise<Item | null> {
    const response = await this.client.send(new GetItemCommand({ TableName: this.table,
      Key: { pk: s(pk), sk: s(sk) }, ConsistentRead: true }));
    return response.Item ?? null;
  }
  private async query(pk: string, prefix: string | null, max: number): Promise<Item[]> {
    const response = await this.client.send(new QueryCommand({ TableName: this.table,
      ConsistentRead: true, KeyConditionExpression: prefix === null ? 'pk = :pk' : 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: prefix === null ? { ':pk': s(pk) } : { ':pk': s(pk), ':sk': s(prefix) }, Limit: max + 1 }));
    if (response.LastEvaluatedKey || (response.Items?.length ?? 0) > max) throw new Error('Billing result limit exceeded');
    return response.Items ?? [];
  }
  async getConfig(slug: string): Promise<BillingConfig | null> {
    const item = await this.get(`CLINIC#${slug}#CONFIG`, 'BILLING');
    if (!item) return null;
    const currency = (item.currency as { S?: string } | undefined)?.S;
    const fee = Number((item.consultationFeePaise as { N?: string } | undefined)?.N);
    const version = Number((item.version as { N?: string } | undefined)?.N);
    if (currency !== 'INR' || !validPaise(fee) || fee <= 0 || !Number.isSafeInteger(version) || version < 1) {
      throw new Error('Invalid billing configuration');
    }
    return { currency, consultationFeePaise: fee, version };
  }
  async listEpisodes(slug: string, clinicDate: string): Promise<BillEpisode[]> {
    const rows = await this.query(indexPk(slug, clinicDate), 'EPISODE#', 200);
    return rows.map((row) => {
      const episode = json<BillEpisode>(row, 'episode index');
      if ((row.sk as { S?: string })?.S !== `EPISODE#${episode.appointmentId}` ||
          episode.clinicDate !== clinicDate) throw new Error('Invalid billing index');
      return episode;
    });
  }
  async load(slug: string, appointmentId: string): Promise<EpisodeRecords> {
    const pk = billingPk(slug, appointmentId);
    const rows = await this.query(pk, null, 250);
    const records: EpisodeRecords = { episode: null, charges: [], payments: [], fulfillment: [], receipt: null };
    for (const row of rows) {
      const sk = (row.sk as { S?: string } | undefined)?.S ?? '';
      if (sk === 'META') records.episode = json<BillEpisode>(row, 'episode');
      else if (sk.startsWith('CHARGE#')) records.charges.push(json<BillCharge>(row, 'charge'));
      else if (sk.startsWith('PAYMENT#')) records.payments.push(json<BillPayment>(row, 'payment'));
      else if (sk.startsWith('FULFILL#')) records.fulfillment.push(json<FulfillmentEvent>(row, 'fulfillment'));
      else if (sk === 'RECEIPT') records.receipt = json<BillReceipt>(row, 'receipt');
    }
    if (records.episode?.appointmentId !== appointmentId && records.episode !== null) {
      throw new Error('Billing appointment mismatch');
    }
    if (records.charges.length > 100 || records.payments.length > 100 || records.fulfillment.length > 100) {
      throw new Error('Billing record limit exceeded');
    }
    return records;
  }
  async getOperation(slug: string, appointmentId: string, operationId: string): Promise<BillOperation | null> {
    const row = await this.get(billingPk(slug, appointmentId), `OP#${operationId}`);
    if (!row) return null;
    const op = json<BillOperation>(row, 'operation');
    if (op.id !== operationId) throw new Error('Billing operation mismatch');
    return op;
  }
  async commit(slug: string, write: BillingWrite): Promise<boolean> {
    const { appointment, nextEpisode, operation } = write;
    const pk = billingPk(slug, appointment.id);
    const txn: TransactWriteItem[] = [];
    const appointmentKey = { pk: s(`CLINIC#${slug}#APPOINTMENTS#${appointment.clinicDate}`),
      sk: s(`AT#${appointment.startUtc}#${appointment.id}`) };
    const appointmentConditions = 'attribute_exists(pk) AND id = :id AND patientId = :patient AND doctorId = :doctor AND #status = :status';
    const appointmentNames = { '#status': 'status' };
    const appointmentValues: Item = { ':id': s(appointment.id), ':patient': s(appointment.patientId),
      ':doctor': s(appointment.doctorId), ':status': s(write.checkInBooked ? 'booked' : appointment.status) };
    if (write.checkInBooked) {
      txn.push({ Update: { TableName: this.table, Key: appointmentKey,
        UpdateExpression: 'SET #status = :checkedIn', ConditionExpression: appointmentConditions,
        ExpressionAttributeNames: appointmentNames,
        ExpressionAttributeValues: { ...appointmentValues, ':checkedIn': s('checked_in') } } });
    } else {
      if (write.requireCheckedIn && appointment.status !== 'checked_in') return false;
      txn.push({ ConditionCheck: { TableName: this.table, Key: appointmentKey,
        ConditionExpression: appointmentConditions, ExpressionAttributeNames: appointmentNames,
        ExpressionAttributeValues: appointmentValues } });
    }
    if (write.configVersion !== undefined) txn.push({ ConditionCheck: { TableName: this.table,
      Key: { pk: s(`CLINIC#${slug}#CONFIG`), sk: s('BILLING') },
      ConditionExpression: '#version = :version AND currency = :currency AND consultationFeePaise = :fee',
      ExpressionAttributeNames: { '#version': 'version' },
      ExpressionAttributeValues: { ':version': n(write.configVersion), ':currency': s('INR'),
        ':fee': n(nextEpisode.consultationTotalPaise) } } });
    if (write.encounterRevision !== undefined) txn.push({ ConditionCheck: { TableName: this.table,
      Key: { pk: s(`CLINIC#${slug}#ENCOUNTERS#${appointment.clinicDate}`),
        sk: s(`APPOINTMENT#${appointment.id}`) },
      ConditionExpression: 'attribute_exists(pk) AND #status = :finalized AND #revision = :revision AND patientId = :patient AND doctorId = :doctor',
      ExpressionAttributeNames: { '#status': 'status', '#revision': 'revision' },
      ExpressionAttributeValues: { ':finalized': s('finalized'), ':revision': n(write.encounterRevision),
        ':patient': s(appointment.patientId), ':doctor': s(appointment.doctorId) } } });
    const meta = put(this.table, pk, 'META', nextEpisode,
      write.previousRevision === 0 ? 'attribute_not_exists(pk)' : '#revision = :expected');
    if (meta.Put && write.previousRevision !== 0) {
      meta.Put.Item!.revision = n(nextEpisode.revision);
      meta.Put.ExpressionAttributeNames = { '#revision': 'revision' };
      meta.Put.ExpressionAttributeValues = { ':expected': n(write.previousRevision) };
    } else if (meta.Put) meta.Put.Item!.revision = n(nextEpisode.revision);
    txn.push(meta);
    // Meta's compare-and-swap serializes every writer, so replacing this date index is safe.
    txn.push({ Put: { TableName: this.table, Item: {
      pk: s(indexPk(slug, appointment.clinicDate)), sk: s(`EPISODE#${appointment.id}`),
      document: s(JSON.stringify(nextEpisode)),
    } } });
    for (const charge of write.charges ?? []) txn.push(put(this.table, pk, `CHARGE#${charge.id}`, charge));
    if (write.payment) txn.push(put(this.table, pk, `PAYMENT#${write.payment.id}`, write.payment));
    if (write.fulfillment) txn.push(put(this.table, pk, `FULFILL#${write.fulfillment.id}`, write.fulfillment));
    if (write.receipt) txn.push(put(this.table, pk, 'RECEIPT', write.receipt));
    txn.push(put(this.table, pk, `OP#${operation.id}`, operation));
    txn.push({ Put: { TableName: this.table, Item: { pk: s(`CLINIC#${slug}#AUDIT`),
      sk: s(`${operation.at}#${randomUUID()}`), action: s(`billing.${operation.kind}`),
      actorSub: s(write.actorSub),
      targetId: s(appointment.id), at: s(operation.at), revision: n(nextEpisode.revision) },
      ConditionExpression: 'attribute_not_exists(pk)' } });
    if (txn.length > 25) throw new Error('Billing write too large');
    try {
      await this.client.send(new TransactWriteItemsCommand({ TransactItems: txn }));
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'TransactionCanceledException') {
        const reasons = (error as Error & { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons;
        if (reasons?.some((reason) => reason.Code === 'ConditionalCheckFailed')) return false;
      }
      throw error;
    }
  }
}
