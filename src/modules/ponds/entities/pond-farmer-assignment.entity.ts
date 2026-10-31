import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  type Relation,
} from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import { Pond } from './pond.entity.js';

/** A manager grants a farmer access to operate one pond. */
@Entity('pond_farmer_assignments')
@Unique('uq_pond_farmer_assignments_pond_farmer', ['pondId', 'farmerId'])
export class PondFarmerAssignment {
  @PrimaryGeneratedColumn('uuid', { name: 'assignment_id' })
  assignmentId: string;

  @Column({ name: 'pond_id', type: 'uuid' })
  pondId: string;

  @Column({ name: 'farmer_id', type: 'uuid' })
  farmerId: string;

  @CreateDateColumn({ name: 'assigned_at', type: 'timestamptz' })
  assignedAt: Date;

  @ManyToOne(() => Pond, (pond) => pond.farmerAssignments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pond_id' })
  pond: Relation<Pond>;

  @ManyToOne(() => User, (user) => user.pondAssignments, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'farmer_id' })
  farmer: Relation<User>;
}
