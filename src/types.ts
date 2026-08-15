export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface MonitoringConfig {
  isActive: boolean;
  intervalMin: number;
  intervalMax: number;
  targetUrl?: string;
  targetTabId?: number;
  lastCheckTime?: number;
  attemptCount?: number;
  attemptLog?: number[];
}

export interface StorageData {
  telegram?: TelegramConfig;
  monitoring: MonitoringConfig;
}

export enum MessageType {
  START_MONITORING = 'START_MONITORING',
  STOP_MONITORING = 'STOP_MONITORING',
  GET_STATUS = 'GET_STATUS',
  SAVE_SETTINGS = 'SAVE_SETTINGS',
}

export interface Message {
  type: MessageType;
  payload?: unknown;
}

export interface MessageResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}
