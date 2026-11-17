import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Idempotency ledger kept outside the Timescale hypertable.  Timescale unique
 * constraints on telemetry_data must include recorded_at, which would not
 * enforce the deviceId + messageId contract required by the edge queue.
 */
@Entity('telemetry_ingest_receipts')
@Index('uq_telemetry_ingest_receipt_device_message', ['deviceId', 'messageId'], {
  unique: true,
})
export class TelemetryIngestReceipt {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'uuid', name: 'device_id' })
  deviceId: string;

  @Column({ type: 'varchar', length: 64, name: 'message_id' })
  messageId: string;

  @Column({ type: 'bigint', name: 'telemetry_id', nullable: true })
  telemetryId: string | null;

  @Column({ type: 'timestamp with time zone', name: 'created_at', default: () => 'now()' })
  createdAt: Date;
}
