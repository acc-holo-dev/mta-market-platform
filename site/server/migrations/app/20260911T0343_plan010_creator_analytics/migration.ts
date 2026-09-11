#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1964aa6e342e76ac59307151c6111f7f53a7208ce6667357b254eb773689b065/contract';
import startContract from '../../snapshots/1964aa6e342e76ac59307151c6111f7f53a7208ce6667357b254eb773689b065/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/eefc89aa395f121293557bc0c461a86bc3654b1f43c32fdfea426402b4171e21/contract';
import endContract from '../../snapshots/eefc89aa395f121293557bc0c461a86bc3654b1f43c32fdfea426402b4171e21/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'resourceViewDaily',
        columns: [
          col('day', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resourceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('views', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'resourceViewDaily',
        constraint: 'resourceViewDaily_resourceId_day_key',
        columns: ['resourceId', 'day'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'resourceViewDaily',
        index: 'resourceViewDaily_resourceId_idx_72964925',
        columns: ['resourceId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'resourceViewDaily',
        foreignKey: {
          name: 'resourceViewDaily_resourceId_fkey',
          columns: ['resourceId'],
          references: { schema: 'public', table: 'resource', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
