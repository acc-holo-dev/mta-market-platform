#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/771428b323a4abfc7b091f7fea5490a2f32c119cec9bfe5f5eb53f63b4227be1/contract';
import endContract from '../../snapshots/771428b323a4abfc7b091f7fea5490a2f32c119cec9bfe5f5eb53f63b4227be1/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/aefd63a960222650779340cf9b29ee52e7b24ec73b59d10cb37f494167eb1a66/contract';
import startContract from '../../snapshots/aefd63a960222650779340cf9b29ee52e7b24ec73b59d10cb37f494167eb1a66/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'resourceMedia',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mimeType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('position', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('resourceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sizeBytes', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('url', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'resource',
        column: col('coverUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'resourceMedia',
        index: 'resourceMedia_resourceId_idx_72964925',
        columns: ['resourceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'resourceMedia',
        index: 'resourceMedia_resourceId_kind_idx_bf2cb113',
        columns: ['resourceId', 'kind'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'resourceMedia',
        foreignKey: {
          name: 'resourceMedia_resourceId_fkey',
          columns: ['resourceId'],
          references: { schema: 'public', table: 'resource', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
