#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/021fb1f74e5f03b3a39cd9cb4f235cb2fc16d1ac5a4a193217370e7806a89d71/contract';
import endContract from '../../snapshots/021fb1f74e5f03b3a39cd9cb4f235cb2fc16d1ac5a4a193217370e7806a89d71/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/5841e59d7b47f5316b290c36866bd80d3bf727b8ec75cbfe6c1271d6175ea19a/contract';
import startContract from '../../snapshots/5841e59d7b47f5316b290c36866bd80d3bf727b8ec75cbfe6c1271d6175ea19a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'notification',
        constraint: 'notification_type_check_7029523f',
      }),
      this.createTable({
        schema: 'public',
        table: 'resourceFollow',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resourceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'sellerFollow',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('followerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sellerUserId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'notification',
        constraint: 'notification_type_check_5e911290',
        expression:
          "\"type\" IN ('SERVER_NEWS', 'SERVER_UPDATE', 'FORUM_REPLY', 'REVIEW_EVENT', 'MODERATION', 'CREATOR_RESOURCE', 'CREATOR_ARTICLE', 'RESOURCE_UPDATE')",
      }),
      this.addUnique({
        schema: 'public',
        table: 'resourceFollow',
        constraint: 'resourceFollow_userId_resourceId_key',
        columns: ['userId', 'resourceId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'sellerFollow',
        constraint: 'sellerFollow_followerId_sellerUserId_key',
        columns: ['followerId', 'sellerUserId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'resourceFollow',
        index: 'resourceFollow_resourceId_idx_72964925',
        columns: ['resourceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'resourceFollow',
        index: 'resourceFollow_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sellerFollow',
        index: 'sellerFollow_followerId_idx_2aa6c62d',
        columns: ['followerId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sellerFollow',
        index: 'sellerFollow_sellerUserId_idx_3d9f6a46',
        columns: ['sellerUserId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'resourceFollow',
        foreignKey: {
          name: 'resourceFollow_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'resourceFollow',
        foreignKey: {
          name: 'resourceFollow_resourceId_fkey',
          columns: ['resourceId'],
          references: { schema: 'public', table: 'resource', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sellerFollow',
        foreignKey: {
          name: 'sellerFollow_followerId_fkey',
          columns: ['followerId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sellerFollow',
        foreignKey: {
          name: 'sellerFollow_sellerUserId_fkey',
          columns: ['sellerUserId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
