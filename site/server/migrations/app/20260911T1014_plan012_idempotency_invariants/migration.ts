#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/b1dbf93b4e9242d6c20697c3044b1bcff174d75274cfe580a57e91be286a8a2b/contract';
import endContract from '../../snapshots/b1dbf93b4e9242d6c20697c3044b1bcff174d75274cfe580a57e91be286a8a2b/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/eefc89aa395f121293557bc0c461a86bc3654b1f43c32fdfea426402b4171e21/contract';
import startContract from '../../snapshots/eefc89aa395f121293557bc0c461a86bc3654b1f43c32fdfea426402b4171e21/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropConstraint({
        schema: 'public',
        table: 'payment',
        constraint: 'payment_orderItemId_key',
      }),
      this.dropConstraint({
        schema: 'public',
        table: 'payment',
        constraint: 'payment_purchaseId_key',
      }),
      this.createTable({
        schema: 'public',
        table: 'idempotencyRecord',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('expiresAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('operation', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('requestHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('responseBody', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('responseStatus', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('PROCESSING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'idempotencyRecord_status_check_3bdcefb2',
            "\"status\" IN ('PROCESSING', 'COMPLETED', 'FAILED')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'idempotencyRecord',
        constraint: 'idempotencyRecord_operation_key_key',
        columns: ['operation', 'key'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dispute',
        index: 'dispute_purchase_open_uq_7bda247e',
        columns: ['purchaseId'],
        extras: { where: "(status <> 'CLOSED')", unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'dispute',
        index: 'dispute_service_purchase_open_uq_17878f7f',
        columns: ['servicePurchaseId'],
        extras: { where: "(status <> 'CLOSED')", unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'financialTransaction',
        index: 'financial_txn_settlement_once_uq_71476c91',
        columns: ['relatedPurchaseId'],
        extras: {
          where: '("type" = \'SELLER_REVENUE\' AND "relatedPurchaseId" IS NOT NULL)',
          unique: true,
        },
      }),
      this.createIndex({
        schema: 'public',
        table: 'idempotencyRecord',
        index: 'idempotencyRecord_expiresAt_idx_6b6b8c10',
        columns: ['expiresAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'ledgerEntry',
        index: 'ledger_entry_tx_account_direction_uq_ba5138f9',
        columns: ['transactionId', 'accountId', 'direction'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'payment',
        index: 'payment_orderitem_captured_uq_edd87aa3',
        columns: ['orderItemId'],
        extras: {
          where:
            "(status IN ('SUCCEEDED', 'SETTLEMENT_PENDING', 'SETTLED', 'REFUNDED', 'PARTIALLY_REFUNDED'))",
          unique: true,
        },
      }),
      this.createIndex({
        schema: 'public',
        table: 'payment',
        index: 'payment_purchase_captured_uq_7bc2a98a',
        columns: ['purchaseId'],
        extras: {
          where:
            "(status IN ('SUCCEEDED', 'SETTLEMENT_PENDING', 'SETTLED', 'REFUNDED', 'PARTIALLY_REFUNDED'))",
          unique: true,
        },
      }),
      this.createIndex({
        schema: 'public',
        table: 'purchase',
        index: 'purchase_buyer_resource_live_uq_653bdf5e',
        columns: ['buyerId', 'resourceId'],
        extras: { where: "(status IN ('PENDING', 'COMPLETED'))", unique: true },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
