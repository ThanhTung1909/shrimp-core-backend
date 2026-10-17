import { ThresholdConfig } from '../entities/threshold-config.entity.js';

export interface MessageResponse<T> {
  message: string;
  data: T;
}

export interface MessageOnlyResponse {
  message: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ThresholdResponse extends ThresholdConfig {
  id: string;
  parameterId: string;
  parameterName: string;
  unit: string;
  color: string;
  normalMin: number;
  normalMax: number;
  dangerMin: number;
  dangerMax: number;
}

export interface ThresholdMetricMetadata {
  unit: string;
  color: string;
  dangerFactor: number;
}
