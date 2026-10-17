export const QUEUE_NOTIFICATIONS = 'notifications';
export const QUEUE_PREDICTIONS = 'predictions';

export const NOTIFICATION_JOBS = {
  SEND_EMAIL: 'send-email',
  SEND_SMS: 'send-sms',
  SEND_FCM: 'send-fcm',
} as const;

export const PREDICTION_JOBS = {
  TRIGGER_POND: 'trigger-pond-prediction',
  CRON_ACTIVE_PONDS: 'cron-active-ponds-prediction',
} as const;

export interface SendEmailJobData {
  type: 'initial-password' | 'general';
  email: string;
  fullName?: string;
  phoneNumber?: string;
  password?: string;
  subject?: string;
  text?: string;
}

export interface SendSmsJobData {
  phone: string;
  otp: string;
}

export interface SendFcmJobData {
  fcmToken: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface TriggerPondPredictionJobData {
  pondId: string;
}
