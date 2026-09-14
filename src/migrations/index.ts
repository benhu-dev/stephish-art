import * as migration_20260913_090640_initial_payload_schema from './20260913_090640_initial_payload_schema';
import * as migration_20260914_071449_enable_payload_rls from './20260914_071449_enable_payload_rls';
import * as migration_20260914_075822_add_customers from './20260914_075822_add_customers';

export const migrations = [
  {
    up: migration_20260913_090640_initial_payload_schema.up,
    down: migration_20260913_090640_initial_payload_schema.down,
    name: '20260913_090640_initial_payload_schema',
  },
  {
    up: migration_20260914_071449_enable_payload_rls.up,
    down: migration_20260914_071449_enable_payload_rls.down,
    name: '20260914_071449_enable_payload_rls',
  },
  {
    up: migration_20260914_075822_add_customers.up,
    down: migration_20260914_075822_add_customers.down,
    name: '20260914_075822_add_customers'
  },
];
