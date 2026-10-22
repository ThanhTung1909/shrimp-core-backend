import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn, type Relation } from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import { Pond } from '../../ponds/entities/pond.entity.js';

@Entity('farms')
export class Farm {
  @PrimaryGeneratedColumn('uuid', { name: 'farm_id' })
  farmId: string;

  @Column({ name: 'farm_name', type: 'varchar', length: 150 })
  farmName: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  address: string | null;

  @Column({ name: 'total_area', type: 'numeric', precision: 14, scale: 2, nullable: true })
  totalArea: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => User, (user) => user.farms, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_id' })
  owner: Relation<User>;

  @OneToMany(() => Pond, (pond) => pond.farm)
  ponds: Relation<Pond>[];
}
