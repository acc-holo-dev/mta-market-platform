#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/bfa9bb326915b6c5a42c3dc2dc982336146c700727f058ac727e26ca09059d98/contract';
import startContract from '../../snapshots/bfa9bb326915b6c5a42c3dc2dc982336146c700727f058ac727e26ca09059d98/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/fae5ec8b3bd61d7a252362bafa8271495f8f9c4dc55393ea790a41ff5c33b930/contract';
import endContract from '../../snapshots/fae5ec8b3bd61d7a252362bafa8271495f8f9c4dc55393ea790a41ff5c33b930/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'forumThread',
        column: col('resourceId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'forumThread',
        constraint: 'forumThread_resourceId_key',
        columns: ['resourceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'forumThread',
        index: 'forumThread_resourceId_idx_72964925',
        columns: ['resourceId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'forumThread',
        foreignKey: {
          name: 'forumThread_resourceId_fkey',
          columns: ['resourceId'],
          references: { schema: 'public', table: 'resource', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
