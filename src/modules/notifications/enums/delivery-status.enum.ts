export enum DeliveryStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  // The provider accepted the send request; this is not end-device/inbox delivery.
  PROVIDER_ACCEPTED = 'PROVIDER_ACCEPTED',
  // Legacy records created before P1-2 status clarification.
  SENT = 'SENT',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}
