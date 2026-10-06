import * as migration_20260913_090640_initial_payload_schema from './20260913_090640_initial_payload_schema';
import * as migration_20260914_071449_enable_payload_rls from './20260914_071449_enable_payload_rls';
import * as migration_20260914_075822_add_customers from './20260914_075822_add_customers';
import * as migration_20260914_084256_add_orders from './20260914_084256_add_orders';
import * as migration_20260914_090914_add_checkout_settings from './20260914_090914_add_checkout_settings';
import * as migration_20260915_071331_add_order_uploads from './20260915_071331_add_order_uploads';
import * as migration_20260915_102514_add_checkout_intents from './20260915_102514_add_checkout_intents';
import * as migration_20260917_080014_add_stripe_checkout_sessions from './20260917_080014_add_stripe_checkout_sessions';
import * as migration_20260918_073547_add_stripe_webhook_fulfillment from './20260918_073547_add_stripe_webhook_fulfillment';
import * as migration_20260924_075033_persist_artist_note from './20260924_075033_persist_artist_note';
import * as migration_20260927_223710_add_email_outbox from './20260927_223710_add_email_outbox';
import * as migration_20261001_080010_add_storefront_rate_limits from './20261001_080010_add_storefront_rate_limits';
import * as migration_20261001_084550_add_stripe_refund_dispute_reconciliation from './20261001_084550_add_stripe_refund_dispute_reconciliation';
import * as migration_20261002_105432_add_order_fulfillment from './20261002_105432_add_order_fulfillment';
import * as migration_20261002_113320_add_customer_shipped_email from './20261002_113320_add_customer_shipped_email';
import * as migration_20261006_105253_add_postcard_template_catalog from './20261006_105253_add_postcard_template_catalog';

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
    name: '20260914_075822_add_customers',
  },
  {
    up: migration_20260914_084256_add_orders.up,
    down: migration_20260914_084256_add_orders.down,
    name: '20260914_084256_add_orders',
  },
  {
    up: migration_20260914_090914_add_checkout_settings.up,
    down: migration_20260914_090914_add_checkout_settings.down,
    name: '20260914_090914_add_checkout_settings',
  },
  {
    up: migration_20260915_071331_add_order_uploads.up,
    down: migration_20260915_071331_add_order_uploads.down,
    name: '20260915_071331_add_order_uploads',
  },
  {
    up: migration_20260915_102514_add_checkout_intents.up,
    down: migration_20260915_102514_add_checkout_intents.down,
    name: '20260915_102514_add_checkout_intents',
  },
  {
    up: migration_20260917_080014_add_stripe_checkout_sessions.up,
    down: migration_20260917_080014_add_stripe_checkout_sessions.down,
    name: '20260917_080014_add_stripe_checkout_sessions',
  },
  {
    up: migration_20260918_073547_add_stripe_webhook_fulfillment.up,
    down: migration_20260918_073547_add_stripe_webhook_fulfillment.down,
    name: '20260918_073547_add_stripe_webhook_fulfillment',
  },
  {
    up: migration_20260924_075033_persist_artist_note.up,
    down: migration_20260924_075033_persist_artist_note.down,
    name: '20260924_075033_persist_artist_note',
  },
  {
    up: migration_20260927_223710_add_email_outbox.up,
    down: migration_20260927_223710_add_email_outbox.down,
    name: '20260927_223710_add_email_outbox',
  },
  {
    up: migration_20261001_080010_add_storefront_rate_limits.up,
    down: migration_20261001_080010_add_storefront_rate_limits.down,
    name: '20261001_080010_add_storefront_rate_limits',
  },
  {
    up: migration_20261001_084550_add_stripe_refund_dispute_reconciliation.up,
    down: migration_20261001_084550_add_stripe_refund_dispute_reconciliation.down,
    name: '20261001_084550_add_stripe_refund_dispute_reconciliation',
  },
  {
    up: migration_20261002_105432_add_order_fulfillment.up,
    down: migration_20261002_105432_add_order_fulfillment.down,
    name: '20261002_105432_add_order_fulfillment',
  },
  {
    up: migration_20261002_113320_add_customer_shipped_email.up,
    down: migration_20261002_113320_add_customer_shipped_email.down,
    name: '20261002_113320_add_customer_shipped_email',
  },
  {
    up: migration_20261006_105253_add_postcard_template_catalog.up,
    down: migration_20261006_105253_add_postcard_template_catalog.down,
    name: '20261006_105253_add_postcard_template_catalog'
  },
];
