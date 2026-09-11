#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/021fb1f74e5f03b3a39cd9cb4f235cb2fc16d1ac5a4a193217370e7806a89d71/contract';
import startContract from '../../snapshots/021fb1f74e5f03b3a39cd9cb4f235cb2fc16d1ac5a4a193217370e7806a89d71/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/1964aa6e342e76ac59307151c6111f7f53a7208ce6667357b254eb773689b065/contract';
import endContract from '../../snapshots/1964aa6e342e76ac59307151c6111f7f53a7208ce6667357b254eb773689b065/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'forumThreadFollow',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('threadId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'forumThreadFollow',
        constraint: 'forumThreadFollow_userId_threadId_key',
        columns: ['userId', 'threadId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'forumThreadFollow',
        index: 'forumThreadFollow_threadId_idx_6deac339',
        columns: ['threadId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'forumThreadFollow',
        index: 'forumThreadFollow_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'forumThreadFollow',
        foreignKey: {
          name: 'forumThreadFollow_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'forumThreadFollow',
        foreignKey: {
          name: 'forumThreadFollow_threadId_fkey',
          columns: ['threadId'],
          references: { schema: 'public', table: 'forumThread', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
